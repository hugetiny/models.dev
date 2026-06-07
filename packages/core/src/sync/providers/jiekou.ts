import { z } from "zod";

import type { SyncProvider, SyncedModel } from "../index.js";

const JiekouModel = z.object({
  id: z.string(),
  title: z.string().optional(),
  display_name: z.string().optional(),
  created: z.number().optional(),
  input_token_price_per_m: z.number().optional(),
  output_token_price_per_m: z.number().optional(),
  context_size: z.number().optional(),
  max_output_tokens: z.number().optional(),
  features: z.array(z.string()).optional(),
  input_modalities: z.array(z.string()).optional(),
  output_modalities: z.array(z.string()).optional(),
}).passthrough();

type JiekouModel = z.infer<typeof JiekouModel>;

const SKIP_MODELS = ["google/gemma-*", "gpt-4*", "o1"];
const OPEN_WEIGHTS_PREFIXES = ["deepseek", "qwen", "llama", "gemma", "mistral", "phi", "yi", "baichuan", "glm", "ernie", "minimax"];

export const jiekou = {
  id: "jiekou",
  name: "Jiekou",
  modelsDir: "providers/jiekou/models",
  async fetchModels() {
    const res = await fetch("https://api.jiekou.ai/openai/models");
    if (!res.ok) throw new Error(`Jiekou API failed: ${res.status}`);
    return await res.json();
  },
  parseModels(raw: any) {
    if (!raw?.data || !Array.isArray(raw.data)) return [];
    return raw.data
      .map((m: any) => JiekouModel.parse(m))
      .filter((m: any) => !shouldSkip(m.id));
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
} satisfies SyncProvider<JiekouModel>;

function shouldSkip(id: string): boolean {
  for (const pattern of SKIP_MODELS) {
    if (pattern.includes("*")) {
      const prefix = pattern.slice(0, -1);
      if (id.startsWith(prefix)) return true;
    } else if (id === pattern) {
      return true;
    }
  }
  return false;
}

function isOpenWeights(id: string): boolean {
  return OPEN_WEIGHTS_PREFIXES.some(p => id.toLowerCase().includes(p));
}

function buildModel(model: JiekouModel, existing, baseModel: string): SyncedModel {
  const name = model.display_name || model.title || model.id.split("/").pop() || model.id;
  const features = model.features ?? [];
  const attachment = (model.input_modalities ?? []).some(m => ["image", "video", "audio"].includes(m.toLowerCase()));

  const result: SyncedModel = {
    base_model: baseModel,
    name,
    attachment,
    reasoning: features.includes("reasoning"),
    tool_call: features.includes("function-calling"),
    open_weights: isOpenWeights(model.id),
    release_date: model.created ? new Date(model.created * 1000).toISOString().slice(0, 7) : existing.release_date ?? "2024-01",
    last_updated: new Date().toISOString().slice(0, 7),
  };

  if (existing.family) result.family = existing.family;
  if (existing.knowledge) result.knowledge = existing.knowledge;
  if (features.includes("structured-outputs")) result.structured_output = true;

  const cost: Record<string, number> = {};
  if (model.input_token_price_per_m !== undefined) cost.input = model.input_token_price_per_m / 10000;
  if (model.output_token_price_per_m !== undefined) cost.output = model.output_token_price_per_m / 10000;
  if (Object.keys(cost).length > 0) result.cost = cost;

  const limit: Record<string, number> = {};
  if (model.context_size) limit.context = model.context_size;
  if (model.max_output_tokens) limit.output = model.max_output_tokens;
  if (Object.keys(limit).length > 0) result.limit = limit;

  return result;
}
