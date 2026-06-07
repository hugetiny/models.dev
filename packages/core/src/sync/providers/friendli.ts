import { z } from "zod";

import type { SyncProvider, SyncedModel } from "../index.js";

const FriendliModel = z.object({
  id: z.string(),
  name: z.string(),
  max_completion_tokens: z.number().optional(),
  context_length: z.number().optional(),
  pricing: z.object({
    input: z.number().optional(),
    output: z.number().optional(),
    unit_type: z.enum(["TOKEN", "SECOND"]).optional(),
  }).passthrough().optional(),
  functionality: z.object({
    tool_call: z.boolean().optional(),
    structured_output: z.boolean().optional(),
  }).passthrough().optional(),
  hugging_face_url: z.string().optional(),
  created: z.number().optional(),
}).passthrough();

type FriendliModel = z.infer<typeof FriendliModel>;

const FAMILY_PATTERNS = [
  /llama-3\.3/i,
  /llama-3\.1/i,
  /llama-4/i,
  /qwen3/i,
  /deepseek-r1/i,
  /glm-4/i,
  /glm-5/i,
];

export const friendli = {
  id: "friendli",
  name: "Friendli",
  modelsDir: "providers/friendli/models",
  async fetchModels() {
    const res = await fetch("https://api.friendli.ai/serverless/v1/models");
    if (!res.ok) throw new Error(`Friendli API failed: ${res.status}`);
    return await res.json();
  },
  parseModels(raw: any) {
    if (!raw?.data || !Array.isArray(raw.data)) return [];
    return raw.data
      .map((m: any) => FriendliModel.parse(m))
      .filter((m: any) => m.pricing?.unit_type === "TOKEN");
  },
  translateModel(model, context) {
    const parts = model.id.split("/");
    if (parts.length < 2) return undefined;

    const baseModel = model.id.toLowerCase();
    const existing = context.existing(baseModel);
    if (!existing) return undefined;

    return {
      id: model.id,
      model: buildModel(model, existing, baseModel),
    };
  },
} satisfies SyncProvider<FriendliModel>;

function inferFamily(id: string): string | undefined {
  for (const pattern of FAMILY_PATTERNS) {
    if (pattern.test(id)) {
      const match = id.match(pattern);
      if (match) return match[0].replace(/[\/-]/g, "-").toLowerCase();
    }
  }
  return undefined;
}

function buildModel(model: FriendliModel, existing, baseModel: string): SyncedModel {
  const name = model.name.split("/").pop()?.replace(/-/g, " ") || model.name;
  const reasoning = /r1|thinking|reasoning/i.test(model.id);
  const family = inferFamily(model.id) || existing.family;

  const result: SyncedModel = {
    base_model: baseModel,
    name,
    attachment: false,
    reasoning,
    tool_call: model.functionality?.tool_call ?? false,
    open_weights: !!model.hugging_face_url,
    release_date: model.created ? new Date(model.created * 1000).toISOString().slice(0, 10) : existing.release_date ?? "2024-01-01",
    last_updated: new Date().toISOString().slice(0, 10),
  };

  if (family) result.family = family;
  if (model.functionality?.structured_output) result.structured_output = true;
  if (existing.knowledge) result.knowledge = existing.knowledge;
  if (existing.status) result.status = existing.status;

  const cost: Record<string, number> = {};
  if (model.pricing?.input !== undefined) cost.input = model.pricing.input;
  if (model.pricing?.output !== undefined) cost.output = model.pricing.output;
  if (Object.keys(cost).length > 0) result.cost = cost;

  const limit: Record<string, number> = {};
  if (model.context_length) limit.context = model.context_length;
  if (model.max_completion_tokens) limit.output = model.max_completion_tokens;
  if (Object.keys(limit).length > 0) result.limit = limit;

  return result;
}
