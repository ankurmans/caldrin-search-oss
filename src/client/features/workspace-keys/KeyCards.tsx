import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  removeWorkspaceKey,
  saveWorkspaceKey,
  testWorkspaceKey,
} from "@/serverFunctions/workspace-keys";

export type Kind =
  | "dataforseo"
  | "tinyfish"
  | "llm"
  | "anthropic"
  | "perplexity"
  | "openai"
  | "gemini";

export type Saved = { keyHint: string; provider: string } | undefined;

export function CardShell({
  title,
  description,
  saved,
  kind,
  onChange,
  children,
}: {
  title: string;
  description: string;
  saved: Saved;
  kind: Kind;
  onChange: () => void;
  children: React.ReactNode;
}) {
  const testMutation = useMutation({
    mutationFn: () => testWorkspaceKey({ data: { kind } }),
    onSuccess: (result) =>
      result.ok
        ? toast.success(`${title} key works`)
        : toast.error(result.message),
  });
  const removeMutation = useMutation({
    mutationFn: () => removeWorkspaceKey({ data: { kind } }),
    onSuccess: () => {
      toast.success(`${title} key removed`);
      onChange();
    },
  });
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          {saved ? (
            <span className="font-mono text-xs text-muted-foreground">
              ••••{saved.keyHint}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Not set</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
      {saved ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            {testMutation.isPending ? "Testing…" : "Test"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={removeMutation.isPending}
            onClick={() => removeMutation.mutate()}
          >
            Remove
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function useSaveKey(onChange: () => void, onSaved: () => void) {
  return useMutation({
    mutationFn: (input: Parameters<typeof saveWorkspaceKey>[0]["data"]) =>
      saveWorkspaceKey({ data: input }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Key saved");
      onSaved();
      onChange();
    },
    onError: (error) => toast.error(error.message),
  });
}

export function SimpleKeyCard({
  title,
  description,
  kind = "tinyfish",
  saved,
  onChange,
}: {
  title: string;
  description: string;
  kind?: Kind;
  saved: Saved;
  onChange: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const save = useSaveKey(onChange, () => setApiKey(""));
  return (
    <CardShell
      title={title}
      description={description}
      saved={saved}
      kind={kind}
      onChange={onChange}
    >
      <KeyForm
        placeholder={saved ? "Replace key" : "Paste key"}
        apiKey={apiKey}
        setApiKey={setApiKey}
        pending={save.isPending}
        onSubmit={() => save.mutate({ kind, provider: kind, apiKey })}
      />
    </CardShell>
  );
}

export function KeyForm({
  placeholder,
  apiKey,
  setApiKey,
  pending,
  onSubmit,
}: {
  placeholder: string;
  apiKey: string;
  setApiKey: (value: string) => void;
  pending: boolean;
  onSubmit: () => void;
}) {
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Input
        type="password"
        autoComplete="off"
        aria-label="API key"
        placeholder={placeholder}
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
      />
      <Button type="submit" disabled={pending || apiKey.trim().length < 8}>
        {pending ? "Checking…" : "Save"}
      </Button>
    </form>
  );
}
