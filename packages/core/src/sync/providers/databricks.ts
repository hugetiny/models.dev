import { z } from "zod";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

import type { ExistingModel, SyncProvider, SyncedModel } from "../index.js";

const FoundationModel = z
  .object({
    ai_gateway_v2_supported: z.boolean().optional(),
    api_types: z.array(z.string()).optional(),
  })
  .passthrough();

const ServedEntity = z
  .object({
    foundation_model: FoundationModel.optional(),
  })
  .passthrough();

const Endpoint = z
  .object({
    name: z.string(),
    config: z
      .object({
        served_entities: z.array(ServedEntity).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const FoundationModelsResponse = z
  .object({
    endpoints: z.array(Endpoint),
  })
  .passthrough();

type Endpoint = z.infer<typeof Endpoint>;

const IGNORE_PREFIXES = [
  "databricks-llama-",
  "databricks-meta-llama-",
  "databricks-qwen",
  "databricks-gemma-",
];

const PREFIX_TO_PROVIDER: [string, string][] = [
  ["claude-", "anthropic"],
  ["gpt-", "openai"],
  ["gemini-", "google"],
  ["mistral-", "mistral"],
  ["mixtral-", "mistral"],
];

export const databricks = {
  id: "databricks",
  name: "Databricks",
  modelsDir: "providers/databricks/models",
  async fetchModels() {
    const host = process.env.DATABRICKS_HOST;
    const token = process.env.DATABRICKS_TOKEN;
    if (!host || !token) {
      throw new Error("Databricks sync requires DATABRICKS_HOST and DATABRICKS_TOKEN environment variables");
    }

    const workspace = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const url = `https://${workspace}/api/2.0/serving-endpoints:foundation-models`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Databricks API failed: ${res.status} ${res.statusText}`);
    }

    return await res.json();
  },
  parseModels(raw) {
    const parsed = FoundationModelsResponse.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid Databricks response: ${JSON.stringify(parsed.error.errors)}`);
    }

    return parsed.data.endpoints.filter(
      (e) =>
        !IGNORE_PREFIXES.some((p) => e.name.startsWith(p)) &&
        e.config?.served_entities?.some(
          (se) =>
            se.foundation_model?.ai_gateway_v2_supported === true &&
            se.foundation_model?.api_types?.includes("mlflow/v1/chat/completions"),
        ),
    );
  },
  translateModel(model, context) {
    const bare = model.name.replace(/^databricks-/, "");
    const baseModel = resolveCanonical(bare);

    if (!baseModel) {
      console.warn(`No canonical model found for ${model.name}; creating stub`);
      return {
        id: model.name,
        model: {
          name: model.name,
          attachment: false,
          reasoning: false,
          tool_call: false,
          open_weights: false,
          cost: { input: 0, output: 0 },
          limit: { context: 0, input: 0, output: 0 },
          modalities: { input: ["text"], output: ["text"] },
        },
      };
    }

    const existing = context.existing(baseModel);
    if (existing === undefined) {
      console.warn(`Base model ${baseModel} not found; creating stub for ${model.name}`);
      return {
        id: model.name,
        model: {
          name: model.name,
          attachment: false,
          reasoning: false,
          tool_call: false,
          open_weights: false,
          cost: { input: 0, output: 0 },
          limit: { context: 0, input: 0, output: 0 },
          modalities: { input: ["text"], output: ["text"] },
        },
      };
    }

    return {
      id: model.name,
      model: {
        base_model: baseModel,
      },
    };
  },
} satisfies SyncProvider<Endpoint>;

function resolveCanonical(bare: string): string | null {
  // Meta Llama: "meta-llama-3-3-70b-instruct" → "llama-3.3-70b-instruct"
  if (bare.startsWith("meta-llama-") || bare.startsWith("llama-")) {
    const llamaId = bare
      .replace(/^meta-llama-/, "llama-")
      .replace(/^(llama-\d+)-(\d+)-/, "$1.$2-");
    const metadata = path.join(process.cwd(), "models", "meta", `${llamaId}.toml`);
    if (existsSync(metadata)) {
      return `meta/${llamaId}`;
    }
  }

  for (const [prefix, provider] of PREFIX_TO_PROVIDER) {
    if (!bare.startsWith(prefix)) continue;

    // Try exact match
    const exact = path.join(process.cwd(), "providers", provider, "models", `${bare}.toml`);
    if (existsSync(exact)) return `${provider}/${bare}`;

    // Try with hyphens-as-dots in version (e.g. gpt-5-4 → gpt-5.4)
    const dotted = bare.replace(/^((?:[a-z]+-)+\d+)-(\d)/, "$1.$2");
    if (dotted !== bare) {
      const dottedExact = path.join(process.cwd(), "providers", provider, "models", `${dotted}.toml`);
      if (existsSync(dottedExact)) return `${provider}/${dotted}`;
    }
  }

  return null;
}
