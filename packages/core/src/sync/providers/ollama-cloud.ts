import { z } from "zod";

import type { SyncProvider, SyncedModel } from "../index.js";

const OllamaModel = z.object({
  name: z.string(),
  modified_at: z.string().optional(),
  details: z.object({
    family: z.string(),
    parameter_size: z.string().optional(),
  }).passthrough().optional(),
  capabilities: z.array(z.string()).optional(),
}).passthrough();

type OllamaModel = z.infer<typeof OllamaModel>;

export const ollamaCloud = {
  id: "ollama-cloud",
  name: "Ollama Cloud",
  modelsDir: "providers/ollama-cloud/models",
  async fetchModels() {
    const res = await fetch("https://ollama.ai/api/tags");
    if (!res.ok) throw new Error(`Ollama Cloud API failed: ${res.status}`);
    return await res.json();
  },
  parseModels(raw: any) {
    if (!raw?.models || !Array.isArray(raw.models)) return [];
    return raw.models.map((m: any) => OllamaModel.parse(m));
  },
  translateModel(model, context) {
    // Ollama Cloud provides open-source models that are typically hosted elsewhere
    // For now, skip auto-matching and rely on manual base_model mappings
    return undefined;
  },
} satisfies SyncProvider<OllamaModel>;
