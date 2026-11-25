import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getLinkQualificationSettings,
  saveLinkQualificationSettings,
} from "@/serverFunctions/link-acquisition";
import { qualificationSettingsSchema } from "@/types/schemas/link-acquisition";
import { linkGapKeys } from "./linkGap";

type Settings = ReturnType<typeof qualificationSettingsSchema.parse>;
type NumericKey = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];

const FIELDS: Array<{ key: NumericKey; label: string; hint: string }> = [
  {
    key: "minCompetitors",
    label: "Minimum competitors linked",
    hint: "Sites linking to fewer are recommended Skip.",
  },
  {
    key: "softMaxSpamScore",
    label: "Spam score that starts to cost points",
    hint: "0 to 100. A soft penalty, not an exclusion.",
  },
  {
    key: "softMinDomainRank",
    label: "Domain Rank that starts to earn points",
    hint: "On the provider's 0 to 1000 scale. Not an exclusion.",
  },
  {
    key: "weightCompetitors",
    label: "Weight: competitor placements",
    hint: "",
  },
  { key: "weightAuthority", label: "Weight: authority", hint: "" },
  { key: "weightContext", label: "Weight: context", hint: "" },
  { key: "weightFollow", label: "Weight: link attributes", hint: "" },
  { key: "weightPersistence", label: "Weight: persistence", hint: "" },
  { key: "weightEffort", label: "Weight: effort", hint: "" },
  {
    key: "pursueAt",
    label: "Pursue at score",
    hint: "Score from which a site is recommended Pursue.",
  },
  {
    key: "skipBelow",
    label: "Skip below score",
    hint: "Score under which a site is recommended Skip.",
  },
];

function Form({
  projectId,
  initial,
}: {
  projectId: string;
  initial: Settings;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Settings>(initial);
  const parsed = qualificationSettingsSchema.safeParse(draft);
  const save = useMutation({
    mutationFn: (settings: Settings) =>
      saveLinkQualificationSettings({ data: { projectId, settings } }),
    onSuccess: () => {
      toast.success("Qualification settings saved");
      void queryClient.invalidateQueries({
        queryKey: linkGapKeys.table(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: linkGapKeys.settings(projectId),
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label key={field.key} className="grid gap-1.5 text-sm">
            <span className="font-medium">{field.label}</span>
            <Input
              type="number"
              value={draft[field.key]}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [field.key]: Number(event.target.value),
                }))
              }
              className="h-8"
            />
            {field.hint ? (
              <span className="block text-xs text-muted-foreground">
                {field.hint}
              </span>
            ) : null}
          </label>
        ))}
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Preferred page language</span>
          <Input
            value={draft.preferredLanguage ?? ""}
            placeholder="e.g. en"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                preferredLanguage: event.target.value.trim() || null,
              }))
            }
            className="h-8"
          />
          <span className="block text-xs text-muted-foreground">
            Pages in another language lose points. Leave empty to ignore.
          </span>
        </label>
      </div>
      {!parsed.success ? (
        <p role="alert" className="text-sm text-destructive">
          One of the values is out of range.
        </p>
      ) : null}
      <Button
        disabled={!parsed.success || save.isPending}
        onClick={() => parsed.success && save.mutate(parsed.data)}
      >
        Save settings
      </Button>
    </div>
  );
}

/** The scoring weights behind every recommendation, editable by the team. */
export function QualificationSettings({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: linkGapKeys.settings(projectId),
    queryFn: () => getLinkQualificationSettings({ data: { projectId } }),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontal data-icon="inline-start" /> Qualification settings
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Qualification settings</DialogTitle>
          <DialogDescription>
            Every recommendation is scored from these weights, so you can see
            and change why a site is Pursue, Review or Skip. Changes re-score
            stored results without a new provider read.
          </DialogDescription>
        </DialogHeader>
        {query.data ? (
          <Form projectId={projectId} initial={query.data} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
