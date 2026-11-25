import { useEffect, useState } from "react";
import { z } from "zod";
import type { DraftDetail } from "./helpers";

export function savedFields({
  title,
  bodyHtml,
  metaTitle,
  metaDescription,
}: Fields): Fields {
  return { title, bodyHtml, metaTitle, metaDescription };
}

const fieldsSchema = z.object({
  title: z.string(),
  bodyHtml: z.string(),
  metaTitle: z.string(),
  metaDescription: z.string(),
});
const workingCopy = z.object({ revision: z.number(), fields: fieldsSchema });
export type Fields = z.infer<typeof fieldsSchema>;

export function useWorkingDraft(
  projectId: string,
  asset: DraftDetail["asset"],
) {
  const workingKey = `caldrin:draft:${projectId}:${asset.id}`;
  const [fields, setFields] = useState<Fields>(() => savedFields(asset));
  const [recovery, setRecovery] = useState<{
    revision: number;
    fields: Fields;
  } | null>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(workingKey);
      if (stored) {
        const copy = workingCopy.parse(JSON.parse(stored));
        if (copy.revision === asset.revision) setFields(copy.fields);
        else setRecovery(copy);
      }
    } catch {
      // A restricted browser still supports explicit revision saves.
    }
  }, [workingKey, asset.revision]);

  const dirty =
    fields.title !== asset.title ||
    fields.bodyHtml !== asset.bodyHtml ||
    fields.metaTitle !== asset.metaTitle ||
    fields.metaDescription !== asset.metaDescription;
  const remember = (next: Fields) => {
    setFields(next);
    try {
      sessionStorage.setItem(
        workingKey,
        JSON.stringify({ revision: asset.revision, fields: next }),
      );
    } catch {
      // Editing can continue when session storage is unavailable.
    }
  };
  const set = (field: keyof Fields) => (value: string) =>
    remember({ ...fields, [field]: value });
  return {
    fields,
    dirty,
    recovery,
    remember,
    set,
    restore: () => {
      if (recovery) remember(recovery.fields);
      setRecovery(null);
    },
    clear: () => {
      try {
        sessionStorage.removeItem(workingKey);
      } catch {
        /* Storage can be disabled. */
      }
    },
  };
}
