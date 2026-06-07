import { z } from "zod";

import type { SyncProvider, SyncedModel } from "../index.js";

const Pricing = z.object({
  prompt: z.number().optional(),
  completion: z.number().optional(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  reasoning: z.number().optional(),
}).passthrough();

const Endpoint = z.object({
  provider: z.string(),
  providerSlug: z.string().optional(),
  supportsPtb: z.boolean().optional(),
  pricing: Pricing.optional(),
}).passthrough();

const ModelItem = z.object({
  id: z.string(),
  name: z.string(),
  author: z.string().optional(),
  contextLength: z.number().optional(),
  maxOutput: z.number().optional(),
  trainingDate: z.string().optional(),
  description: z.string().optional(),
  inputModalities: z.array(z.string()).optional(),
  outputModalities: z.array(z.string()).optional(),
  supportedParameters: z.array(z.string()).optional(),
  endpoints: z.array(Endpoint).optional(),
}).passthrough();

const HeliconeResponse = z.object({
  data: z.object({
    models: z.array(ModelItem),
    total: z.number().optional(),
    filters: z.any().optional(),
  }),
}).passthrough();

type ModelItem = z.infer<typeof ModelItem>;

export const helicone = {
  id: "helicone",
  name: "Helicone",
  modelsDir: "providers/helicone/models",
  async fetchModels() {
    const res = await fetch("https://jawn.helicone.ai/v1/public/model-registry/models");
    if (!res.ok) {
      throw new Error(`Helicone API failed: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  },
  parseModels(raw) {
    const parsed = HeliconeResponse.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid Helicone response: ${JSON.stringify(parsed.error.errors)}`);
    }
    return parsed.data.data.models;
  },
  translateModel(model, context) {
    // Try to resolve to a base_model using author + endpoint provider matching
    const endpoint = pickEndpoint(model);
    const provider = endpoint?.provider;
    
    if (!provider) {
      return undefined;
    }

    // Try to match canonical provider/model
    const modelId = model.id.replaceAll("/", "-").toLowerCase();
    const baseModel = tryFindBaseModel(provider, model.name, modelId);

    if (!baseModel) {
      return undefined;
    }

    const existing = context.existing(baseModel);
    if (!existing) {
      return undefined;
    }

    return {
      id: modelId,
      model: buildModel(model, existing, baseModel),
    };
  },
} satisfies SyncProvider<ModelItem>;

function pickEndpoint(m: ModelItem) {
  if (!m.endpoints || m.endpoints.length === 0) return undefined;
  if (m.author) {
    const match = m.endpoints.find((e) => e.provider === m.author);
    if (match) return match;
  }
  return m.endpoints[0];
}

function tryFindBaseModel(provider: string, name: string, modelId: string): string | undefined {
  // Map common provider names to canonical providers
  const providerMap: Record<string, string> = {
    openai: "openai",
    anthropic: "anthropic",
    google: "google",
    meta: "meta",
    mistral: "mistral",
    cohere: "cohere",
  };

  const canonical = providerMap[provider.toLowerCase()];
  if (!canonical) return undefined;

  // Try exact match
  return `${canonical}/${modelId}`;
}

function boolFromParams(params: string[] | undefined, keys: string[]): boolean {
  if (!params) return false;
  const set = new Set(params.map((p) => p.toLowerCase()));
  return keys.some((k) => set.has(k.toLowerCase()));
}

function sanitizeModalities(values: string[] | undefined): string[] {
  if (!values) return ["text"];
  const allowed = new Set(["text", "audio", "image", "video", "pdf"]);
  const out = values.map((v) => v.toLowerCase()).filter((v) => allowed.has(v));
  return out.length > 0 ? out : ["text"];
}

function buildModel(model: ModelItem, existing, baseModel: string): SyncedModel {
  const endpoint = pickEndpoint(model);
  const pricing = endpoint?.pricing;
  const supported = model.supportedParameters ?? [];

  const nowISO = new Date().toISOString().slice(0, 10);
  const rdRaw = model.trainingDate ? String(model.trainingDate) : nowISO;
  const releaseDate = rdRaw.slice(0, 10);
  const knowledge = model.trainingDate ? String(model.trainingDate).slice(0, 7) : undefined;

  const temperature = boolFromParams(supported, ["temperature"]);
  const toolCall = boolFromParams(supported, ["tools", "tool_choice"]);
  const reasoning = boolFromParams(supported, ["reasoning", "include_reasoning"]);

  const result: SyncedModel = {
    base_model: baseModel,
    name: model.name,
    attachment: false,
    reasoning,
    temperature: temperature || undefined,
    tool_call: toolCall,
    open_weights: false,
    release_date: releaseDate,
    last_updated: releaseDate,
  };

  if (knowledge) result.knowledge = knowledge;
  if (existing.family) result.family = existing.family;

  // Pricing
  const cost: Record<string, number> = {};
  if (pricing?.prompt !== undefined) cost.input = pricing.prompt;
  if (pricing?.completion !== undefined) cost.output = pricing.completion;
  if (reasoning && pricing?.reasoning !== undefined) cost.reasoning = pricing.reasoning;
  if (pricing?.cacheRead !== undefined) cost.cache_read = pricing.cacheRead;
  if (pricing?.cacheWrite !== undefined) cost.cache_write = pricing.cacheWrite;
  if (Object.keys(cost).length > 0) result.cost = cost;

  // Limits
  const limit: Record<string, number> = {};
  if (model.contextLength !== undefined) limit.context = model.contextLength;
  if (model.maxOutput !== undefined) limit.output = model.maxOutput;
  if (Object.keys(limit).length > 0) result.limit = limit;

  // Modalities
  const inputMods = sanitizeModalities(model.inputModalities);
  const outputMods = sanitizeModalities(model.outputModalities);
  if (inputMods.length > 0 || outputMods.length > 0) {
    result.modalities = {
      input: inputMods,
      output: outputMods,
    };
  }

  return result;
}
