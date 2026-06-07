import { z } from "zod";

import type { SyncProvider } from "../index.js";

const Model = z.object({
  id: z.string(),
  name: z.string(),
}).passthrough();

type Model = z.infer<typeof Model>;

export const digitalocean = {
  id: "digitalocean",
  name: "DigitalOcean",
  modelsDir: "providers/digitalocean/models",
  async fetchModels() {
    throw new Error("DigitalOcean sync not yet implemented");
  },
  parseModels(raw) {
    return [];
  },
  translateModel(model, context) {
    return undefined;
  },
} satisfies SyncProvider<Model>;
