import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CopyButton } from "@/client/components/CopyButton";
import { Button } from "@/client/components/ui/button";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getAiCrawlerSetup,
  rotateAiCrawlerKey,
} from "@/serverFunctions/ai-crawlers";

/** The project's crawler key. A new key is shown once, so it is kept here until the page closes. */
export function useCrawlerKey(projectId: string) {
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState<string | null>(null);
  const setup = useQuery({
    queryKey: ["ai-crawlers", projectId, "setup"],
    queryFn: () => getAiCrawlerSetup({ data: { projectId } }),
  });
  const rotate = useMutation({
    mutationFn: () => rotateAiCrawlerKey({ data: { projectId } }),
    onSuccess: (result) => {
      setNewKey(result.key);
      void queryClient.invalidateQueries({
        queryKey: ["ai-crawlers", projectId],
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  return { setup: setup.data, newKey, rotate };
}

export type CrawlerKeyState = ReturnType<typeof useCrawlerKey>;

export function KeyPanel({ keyState }: { keyState: CrawlerKeyState }) {
  const { setup, newKey, rotate } = keyState;
  if (!setup) return null;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={setup.hasKey ? "outline" : "default"}
          disabled={rotate.isPending}
          onClick={() => rotate.mutate()}
        >
          {setup.hasKey ? "Replace key" : "Create key"}
        </Button>
        {setup.hasKey ? (
          <span className="text-muted-foreground">
            Current key starts {setup.prefix}. Replacing it stops the old one
            working.
            {setup.lastUsedAt
              ? ` Last visit reported ${setup.lastUsedAt.slice(0, 10)}.`
              : " No visit reported yet."}
          </span>
        ) : null}
      </div>
      {newKey ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
          <code className="break-all">{newKey}</code>
          <CopyButton value={newKey} successMessage="Key copied" />
        </div>
      ) : null}
    </div>
  );
}
