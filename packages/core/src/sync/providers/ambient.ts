import { z } from "zod";

import type { ExistingModel, SyncProvider, SyncedModel } from "../index.js";

const API_ENDPOINT = "https://api.ambient.xyz/v1/models";

// Allowlist for the initial rollout.
const ALLOWLIST = new Set<string>([
  "zai-org/GLM-5.1-FP8",
  "moonshotai/kimi-k2.6",
]);

// Maps Ambient model IDs to canonical model metadata IDs in this repo.
const BASE_MODEL_MAP: Record<string, string> = {
  "zai-org/GLM-5.1-FP8": "zhipuai/glm-5.1",
  "moonshotai/kimi-k2.6": "moonshotai/kimi-k2.6",
};

const Pricing = z
  .object({
    prompt: z.string(),
    completion: z.string(),
    input_cache_read: z.string().optional(),
    input_cache_write: z.string().optional(),
  })
  .passthrough();

const AmbientModel = z
  .object({
    id: z.string(),
    name: z.string(),
    context_length: z.number(),
    max_output_length: z.number(),
    input_modalities: z.array(z.string()),
    output_modalities: z.array(z.string()),
    pricing: Pricing,
  })
  .passthrough();

const AmbientResponse = z
  .object({
    object: z.literal("list"),
    data: z.array(AmbientModel),
  })
  .passthrough();

type AmbientModel = z.infer<typeof AmbientModel>;

export const ambient = {
  id: "ambient",
  name: "Ambient",
  modelsDir: "providers/ambient/models",
  skipCreates: true,
  missingNotice(ids) {
    if (ids.length === 0) return [];
    return [
      `${ids.length} Ambient models not created: allowlist limit. See ambient provider config.`,
      `Skipped IDs: ${ids.map((id) => `\`${id}\``).join(", ")}`,
    ];
  },
  async fetchModels() {
    const res = await fetch(API_ENDPOINT);
    if (!res.ok) {
      throw new Error(`Ambient API failed: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  },
  parseModels(raw) {
    const parsed = AmbientResponse.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid Ambient response: ${JSON.stringify(parsed.error.issues)}`);
    }
    return parsed.data.data.filter((m) => ALLOWLIST.has(m.id));
  },
  translateModel(model, context) {
    const baseModel = BASE_MODEL_MAP[model.id];
    if (!baseModel) {
      console.warn(`No BASE_MODEL_MAP entry for ${model.id}; skipping`);
      return undefined;
    }

    const existing = context.existing(baseModel);
    if (existing === undefined) {
      console.warn(`Base model ${baseModel} not found for ${model.id}`);
      return undefined;
    }

    return {
      id: model.id,
      model: buildModel(model, existing),
    };
  },
} satisfies SyncProvider<AmbientModel>;

function buildModel(model: AmbientModel, existing: ExistingModel): SyncedModel {
  const ALLOWED_MODALITIES = new Set(["text", "audio", "image", "video", "pdf"]);
  const modalities = (values: string[]): string[] => {
    return values
      .map((v) => v.toLowerCase())
      .filter((v) => ALLOWED_MODALITIES.has(v));
  };

  const perMTok = (price: string): number => {
    const n = parseFloat(price);
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid price: ${price}`);
    }
    return Math.round(n * 1_000_000 * 1_000_000) / 1_000_000;
  };

  return {
    base_model: BASE_MODEL_MAP[model.id],
    cost: {
      input: perMTok(model.pricing.prompt),
      output: perMTok(model.pricing.completion),
      ...(model.pricing.input_cache_read !== undefined && {
        cache_read: perMTok(model.pricing.input_cache_read),
      }),
      ...(model.pricing.input_cache_write !== undefined && {
        cache_write: perMTok(model.pricing.input_cache_write),
      }),
    },
    limit: {
      context: model.context_length,
      output: model.max_output_length,
    },
    modalities: {
      input: modalities(model.input_modalities),
      output: modalities(model.output_modalities),
    },
  };
}
