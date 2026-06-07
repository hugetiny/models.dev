import { z } from "zod";

import type { SyncProvider, SyncedModel } from "../index.js";

const VeniceModel = z.object({
  id: z.string(),
  name: z.string().optional(),
  modelSource: z.string().optional(),
  pricing: z.object({
    input: z.number().optional(),
    output: z.number().optional(),
  }).passthrough().optional(),
  availableContextTokens: z.number().optional(),
  maxCompletionTokens: z.number().optional(),
  capabilities: z.object({
    supportsVision: z.boolean().optional(),
    supportsReasoning: z.boolean().optional(),
    supportsResponseSchema: z.boolean().optional(),
    supportsFunctionCalling: z.boolean().optional(),
  }).passthrough().optional(),
  description: z.string().optional(),
  created: z.number().optional(),
}).passthrough();

type VeniceModel = z.infer<typeof VeniceModel>;

export const venice = {
  id: "venice",
  name: "Venice",
  modelsDir: "providers/venice/models",
  async fetchModels() {
    const apiKey = process.env.VENICE_API_KEY;
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch("https://api.venice.ai/api/v1/models?type=text", { headers });
    if (!res.ok) throw new Error(`Venice API failed: ${res.status}`);
    return await res.json();
  },
  parseModels(raw: any) {
    if (!raw?.data || !Array.isArray(raw.data)) return [];
    return raw.data.map((m: any) => VeniceModel.parse(m));
  },
  translateModel(model, context) {
    const baseModel = model.id.toLowerCase();
    const existing = context.existing(baseModel);
    if (!existing) return undefined;

    return {
      id: model.id,
      model: buildModel(model, existing, baseModel),
    };
  },
} satisfies SyncProvider<VeniceModel>;

function buildModel(model: VeniceModel, existing, baseModel: string): SyncedModel {
  const caps = model.capabilities ?? {};
  const openWeights = model.modelSource?.toLowerCase().includes("huggingface") ?? false;

  const result: SyncedModel = {
    base_model: baseModel,
    name: model.name || model.id,
    attachment: caps.supportsVision ?? false,
    reasoning: caps.supportsReasoning ?? false,
    tool_call: caps.supportsFunctionCalling ?? false,
    open_weights: openWeights,
    release_date: model.created ? new Date(model.created * 1000).toISOString().slice(0, 10) : existing.release_date ?? "2024-01-01",
    last_updated: new Date().toISOString().slice(0, 10),
  };

  if (existing.family) result.family = existing.family;
  if (existing.knowledge) result.knowledge = existing.knowledge;
  if (existing.status) result.status = existing.status;
  if (caps.supportsResponseSchema) result.structured_output = true;
  if (existing.temperature) result.temperature = true;

  const cost: Record<string, number> = {};
  if (model.pricing?.input) cost.input = model.pricing.input;
  if (model.pricing?.output) cost.output = model.pricing.output;
  if (Object.keys(cost).length > 0) result.cost = cost;

  const limit: Record<string, number> = {};
  if (model.availableContextTokens) limit.context = model.availableContextTokens;
  if (model.maxCompletionTokens) limit.output = model.maxCompletionTokens;
  if (Object.keys(limit).length > 0) result.limit = limit;

  return result;
}
