import type { SkillSource } from "agents/skills";

export function buildSamSkillSource(): SkillSource {
  return {
    id: "local-skills",
    fingerprint: "empty",
    list: async () => [],
    load: async () => null,
  };
}
