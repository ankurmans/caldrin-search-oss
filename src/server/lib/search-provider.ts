import type { CredentialKind } from "@/server/features/workspace/credentials";

export type SearchProvider = Exclude<CredentialKind, "llm">;
