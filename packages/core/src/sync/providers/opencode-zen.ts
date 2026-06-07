import { z } from "zod";

import type { SyncProvider } from "../index.js";

const Model = z.object({
  id: z.string(),
  name: z.string(),
}).passthrough();

type Model = z.infer<typeof Model>;

export const opencodeZen = {
  id: "opencode-zen",
  name: "OpenCode Zen",
  modelsDir: "providers/opencode-zen/models",
  async fetchModels() {
    throw new Error("OpenCode Zen sync not yet implemented");
  },
  parseModels(raw) {
    return [];
  },
  translateModel(model, context) {
    return undefined;
  },
} satisfies SyncProvider<Model>;
