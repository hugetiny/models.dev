import { z } from "zod";

import type { SyncProvider } from "../index.js";

const Model = z.object({
  id: z.string(),
  name: z.string(),
}).passthrough();

type Model = z.infer<typeof Model>;

export const cloudflareAiGateway = {
  id: "cloudflare-ai-gateway",
  name: "Cloudflare AI Gateway",
  modelsDir: "providers/cloudflare-ai-gateway/models",
  async fetchModels() {
    throw new Error("Cloudflare AI Gateway sync not yet implemented");
  },
  parseModels(raw) {
    return [];
  },
  translateModel(model, context) {
    return undefined;
  },
} satisfies SyncProvider<Model>;
