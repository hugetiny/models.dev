import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";

import type { ExistingModel, SyncProvider, SyncedModel } from "../index.js";
import { ModelFamilyValues } from "../../family.js";

const API_ENDPOINT = "https://llm.chutes.ai/v1/models";

const CHUTES_ORG_TO_MODEL_PROVIDER: Record<string, string | undefined> = {
  "MiniMaxAI": "minimax",
  "Qwen": "alibaba",
  "XiaomiMiMo": "xiaomi",
  "deepseek-ai": "deepseek",
  "google": "google",
  "moonshotai": "moonshotai",
  "openai": "openai",
  "zai-org": "zhipuai",
};

const BASE_MODEL_ALIASES: Record<string, string | undefined> = {
  "google/gemma-4-31B-turbo-TEE": "google/gemma-4-31b-it",
  "Qwen/Qwen3-235B-A22B-Instruct-2507-TEE": "alibaba/qwen3-235b-a22b",
};

const Pricing = z.object({
  prompt: z.number().optional(),
  completion: z.number().optional(),
  input_cache_read: z.number().optional(),
}).passthrough();

const ChutesModel = z.object({
  id: z.string(),
  created: z.number(),
  pricing: Pricing.optional(),
  context_length: z.number().optional(),
  max_output_length: z.number().optional(),
  max_model_len: z.number().optional(),
  input_modalities: z.array(z.string()).optional(),
  output_modalities: z.array(z.string()).optional(),
  supported_features: z.array(z.string()).optional(),
  supported_sampling_parameters: z.array(z.string()).optional(),
  quantization: z.string().optional(),
}).passthrough();

const ChutesResponse = z.object({
  data: z.array(ChutesModel),
}).passthrough();

type ChutesModel = z.infer<typeof ChutesModel>;

export const chutes = {
  id: "chutes",
  name: "Chutes",
  modelsDir: "providers/chutes/models",
  async fetchModels() {
    const res = await fetch(API_ENDPOINT);
    if (!res.ok) {
      throw new Error(`Chutes API failed: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  },
  parseModels(raw) {
    const parsed = ChutesResponse.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid Chutes response: ${JSON.stringify(parsed.error.errors)}`);
    }
    return parsed.data.data;
  },
  translateModel(model, context) {
    const [org, ...modelParts] = model.id.split("/");
    const rawModel = modelParts.join("/");
    
    // Humanize name
    const name = rawModel.replace(/-/g, " ");

    // Find base model
    const baseModel = resolveBaseModel(model.id);
    if (!baseModel) {
      console.warn(`No base model found for ${model.id}; skipping`);
      return undefined;
    }

    const existing = context.existing(baseModel);
    if (!existing) {
      console.warn(`Base model ${baseModel} not found for ${model.id}`);
      return undefined;
    }

    // Infer family
    const family = inferFamily(model.id, name) || existing.family;

    return {
      id: model.id,
      model: buildModel(model, existing, baseModel, family, name),
    };
  },
} satisfies SyncProvider<ChutesModel>;

function baseModelCandidates(modelId: string): string[] {
  const alias = BASE_MODEL_ALIASES[modelId];
  const [org, ...modelParts] = modelId.split("/");
  if (org === undefined || modelParts.length === 0) {
    return alias === undefined ? [] : [alias];
  }

  const provider = CHUTES_ORG_TO_MODEL_PROVIDER[org];
  if (provider === undefined) {
    return alias === undefined ? [] : [alias];
  }

  const rawModel = modelParts.join("/");
  if (!rawModel.endsWith("-TEE")) {
    return alias === undefined ? [] : [alias];
  }

  const withoutTee = rawModel.slice(0, -"-TEE".length);
  const lower = withoutTee.toLowerCase();
  const normalized = [
    withoutTee,
    lower,
    lower.replace(/-(?:instruct|thinking)-\d{4}$/, ""),
    lower.replace(/-\d{4}$/, ""),
    lower.replace(/-turbo$/, "-it"),
    lower.replace(/-turbo$/, ""),
  ];

  return [...new Set([alias, ...normalized.map((candidate) => `${provider}/${candidate}`)])
    .values()].filter((candidate): candidate is string => candidate !== undefined);
}

function resolveBaseModel(modelId: string): string | undefined {
  const candidates = baseModelCandidates(modelId);
  for (const candidate of candidates) {
    const path = `models/${candidate}.toml`;
    if (existsSync(path)) {
      return candidate;
    }
  }
  return undefined;
}

function isSubstring(target: string, family: string): boolean {
  return target.toLowerCase().includes(family.toLowerCase());
}

function matchesFamily(target: string, family: string): boolean {
  const targetLower = target.toLowerCase();
  const familyLower = family.toLowerCase();
  let familyIdx = 0;

  for (let i = 0; i < targetLower.length && familyIdx < familyLower.length; i++) {
    if (targetLower[i] === familyLower[familyIdx]) {
      familyIdx++;
    }
  }

  return familyIdx === familyLower.length;
}

function inferFamily(modelId: string, modelName: string): string | undefined {
  const sortedFamilies = [...ModelFamilyValues].sort((a, b) => b.length - a.length);

  // First pass: try exact substring matches
  for (const family of sortedFamilies) {
    if (isSubstring(modelId, family)) {
      return family;
    }
  }

  for (const family of sortedFamilies) {
    if (isSubstring(modelName, family)) {
      return family;
    }
  }

  // Second pass: fall back to subsequence matching
  for (const family of sortedFamilies) {
    if (matchesFamily(modelId, family)) {
      return family;
    }
  }

  for (const family of sortedFamilies) {
    if (matchesFamily(modelName, family)) {
      return family;
    }
  }

  return undefined;
}

function buildModel(
  model: ChutesModel,
  existing: ExistingModel,
  baseModel: string,
  family: string | undefined,
  name: string,
): SyncedModel {
  const result: SyncedModel = {
    base_model: baseModel,
    name,
    attachment: existing.attachment ?? false,
    reasoning: existing.reasoning ?? false,
    tool_call: existing.tool_call ?? false,
    open_weights: existing.open_weights ?? false,
    release_date: existing.release_date ?? "2024-01-01",
    last_updated: new Date().toISOString().slice(0, 10),
  };

  if (family) result.family = family;
  if (existing.knowledge) result.knowledge = existing.knowledge;
  if (existing.temperature) result.temperature = existing.temperature;
  if (existing.structured_output) result.structured_output = existing.structured_output;

  const cost: Record<string, number> = {};
  if (model.pricing?.prompt !== undefined) cost.input = model.pricing.prompt;
  if (model.pricing?.completion !== undefined) cost.output = model.pricing.completion;
  if (model.pricing?.input_cache_read !== undefined) cost.cache_read = model.pricing.input_cache_read;
  if (Object.keys(cost).length > 0) result.cost = cost;

  const limit: Record<string, number> = {};
  if (model.context_length !== undefined) limit.context = model.context_length;
  if (model.max_model_len !== undefined) limit.context = Math.max(limit.context || 0, model.max_model_len);
  if (model.max_output_length !== undefined) limit.output = model.max_output_length;
  if (Object.keys(limit).length > 0) result.limit = limit;

  const modalities: Record<string, string[]> = {};
  if (model.input_modalities && model.input_modalities.length > 0) {
    modalities.input = model.input_modalities.map((m) => m.toLowerCase());
  }
  if (model.output_modalities && model.output_modalities.length > 0) {
    modalities.output = model.output_modalities.map((m) => m.toLowerCase());
  }
  if (Object.keys(modalities).length > 0) result.modalities = modalities;

  return result;
}
