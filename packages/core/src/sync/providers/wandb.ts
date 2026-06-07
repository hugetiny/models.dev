import { z } from "zod";

import type { SyncProvider, SyncedModel } from "../index.js";

const WandbModel = z.object({
  id: z.string(),
  name: z.string(),
  created: z.number().optional(),
  input_modalities: z.array(z.string()).optional(),
  output_modalities: z.array(z.string()).optional(),
  context_length: z.number().optional(),
  max_output_length: z.number().optional(),
  pricing: z.object({
    prompt: z.string().optional(),
    completion: z.string().optional(),
  }).passthrough().optional(),
  supported_features: z.array(z.string()).optional(),
  supported_sampling_parameters: z.array(z.string()).optional(),
}).passthrough();

type WandbModel = z.infer<typeof WandbModel>;

const OPEN_WEIGHTS_PREFIXES = [
  "deepseek-ai/", "meta-llama/", "microsoft/", "MiniMaxAI/",
  "moonshotai/", "nvidia/", "OpenPipe/", "Qwen/", "zai-org/",
];

export const wandb = {
  id: "wandb",
  name: "Wandb",
  modelsDir: "providers/wandb/models",
  async fetchModels() {
    const res = await fetch("https://trace.wandb.ai/inference/analysis/artificialanalysis/models");
    if (!res.ok) throw new Error(`Wandb API failed: ${res.status}`);
    return await res.json();
  },
  parseModels(raw: any) {
    if (!Array.isArray(raw)) return [];
    return raw.map((m: any) => WandbModel.parse(m));
  },
  translateModel(model, context) {
    // Extract canonical provider/model from id
    const parts = model.id.split("/");
    if (parts.length < 2) return undefined;

    const [provider, ...modelParts] = parts;
    const modelId = modelParts.join("/").toLowerCase();
    const baseModel = `${provider.toLowerCase()}/${modelId}`;

    const existing = context.existing(baseModel);
    if (!existing) return undefined;

    return {
      id: model.id,
      model: buildModel(model, existing, baseModel),
    };
  },
} satisfies SyncProvider<WandbModel>;

function priceToPerMillion(value: string): number {
  return parseFloat(value) * 1_000_000;
}

function buildModel(model: WandbModel, existing, baseModel: string): SyncedModel {
  const openWeights = OPEN_WEIGHTS_PREFIXES.some(p => model.id.startsWith(p));
  const features = model.supported_features ?? [];
  const params = model.supported_sampling_parameters ?? [];

  const result: SyncedModel = {
    base_model: baseModel,
    name: model.name,
    attachment: (model.input_modalities ?? []).includes("image"),
    reasoning: model.name.toLowerCase().includes("thinking") || 
               model.name.toLowerCase().includes("r1") ||
               model.name.toLowerCase().includes("reasoning"),
    tool_call: features.includes("tools"),
    open_weights: openWeights,
    release_date: existing.release_date ?? "2024-01-01",
    last_updated: new Date().toISOString().slice(0, 10),
  };

  if (existing.family) result.family = existing.family;
  if (existing.knowledge) result.knowledge = existing.knowledge;
  if (existing.status) result.status = existing.status;
  if (params.some(p => p.includes("temperature"))) result.temperature = true;
  if (features.includes("structured_outputs")) result.structured_output = true;

  const cost: Record<string, number> = {};
  if (model.pricing?.prompt) cost.input = priceToPerMillion(model.pricing.prompt);
  if (model.pricing?.completion) cost.output = priceToPerMillion(model.pricing.completion);
  if (Object.keys(cost).length > 0) result.cost = cost;

  const limit: Record<string, number> = {};
  if (model.context_length) limit.context = model.context_length;
  if (model.max_output_length) limit.output = model.max_output_length;
  if (Object.keys(limit).length > 0) result.limit = limit;

  const modalities: Record<string, string[]> = {};
  if (model.input_modalities) modalities.input = model.input_modalities.filter(m => ["text", "image", "audio", "video", "pdf"].includes(m.toLowerCase()));
  if (model.output_modalities) modalities.output = model.output_modalities.filter(m => ["text", "image", "audio", "video", "pdf"].includes(m.toLowerCase()));
  if (Object.keys(modalities).length > 0) result.modalities = modalities;

  return result;
}
