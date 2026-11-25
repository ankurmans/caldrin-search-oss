import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  LLM_PROVIDERS,
  LLM_PROVIDER_INFO,
  isLlmProvider,
  type LlmProvider,
} from "@/shared/llm-providers";
import {
  getWorkspaceKeys,
  useOwnWorkspaceKeys,
} from "@/serverFunctions/workspace-keys";
import {
  CardShell,
  KeyForm,
  SimpleKeyCard,
  useSaveKey,
  type Saved,
} from "./KeyCards";

const ANSWER_ENGINES = [
  { kind: "anthropic", title: "Claude (Anthropic)" },
  { kind: "perplexity", title: "Perplexity" },
  { kind: "openai", title: "ChatGPT (OpenAI)" },
  { kind: "gemini", title: "Gemini (Google)" },
] as const;

const QUERY_KEY = ["workspace-keys"];

export function WorkspaceKeysSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getWorkspaceKeys(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const modeMutation = useMutation({
    mutationFn: () => useOwnWorkspaceKeys(),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  if (query.isLoading) return <SkeletonCard />;
  if (query.isError)
    return (
      <QueryError error={query.error} fallback="Could not load API keys." />
    );
  const data = query.data;
  if (!data?.canManage) return null;

  const byKind = new Map(data.credentials.map((c) => [c.kind, c]));
  const usesOwnKeys = data.mode === "byok";

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Provider API keys"
        hint="Research runs on your own accounts. Keys are encrypted and only the last four characters are shown."
        action={
          usesOwnKeys ? null : (
            <Button
              size="sm"
              variant="outline"
              disabled={modeMutation.isPending}
              onClick={() => modeMutation.mutate()}
            >
              Use my own keys
            </Button>
          )
        }
      />
      {usesOwnKeys ? null : (
        <p className="text-sm text-muted-foreground">
          This workspace uses the keys that come with its plan. Switching to
          your own keys is permanent for this workspace.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <LlmCard saved={byKind.get("llm")} onChange={refresh} />
        <DataforseoCard saved={byKind.get("dataforseo")} onChange={refresh} />
        <SimpleKeyCard
          title="TinyFish"
          description="Free web search and page fetch, used for audits and website research. Get a key at tinyfish.ai."
          saved={byKind.get("tinyfish")}
          onChange={refresh}
        />
      </div>
      <SectionHeader
        title="Answer engines"
        hint="Prompt Explorer and Claude and Perplexity tracking ask each engine through its own API, billed by the provider at its own price."
      />
      <div className="grid gap-4 md:grid-cols-4">
        {ANSWER_ENGINES.map(({ kind, title }) => (
          <SimpleKeyCard
            key={kind}
            kind={kind}
            title={title}
            description="Add a key to ask this engine."
            saved={byKind.get(kind)}
            onChange={refresh}
          />
        ))}
      </div>
    </section>
  );
}

function DataforseoCard({
  saved,
  onChange,
}: {
  saved: Saved;
  onChange: () => void;
}) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const save = useSaveKey(onChange, () => {
    setLogin("");
    setPassword("");
  });
  return (
    <CardShell
      title="DataForSEO"
      description="Keywords, rankings, backlinks and AI answers. Enter the API login and API password from app.dataforseo.com/api-access."
      saved={saved}
      kind="dataforseo"
      onChange={onChange}
    >
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            kind: "dataforseo",
            provider: "dataforseo",
            apiKey: password,
            login,
          });
        }}
      >
        <Input
          autoComplete="off"
          aria-label="API login"
          placeholder={saved ? "Replace API login" : "API login (your email)"}
          value={login}
          onChange={(event) => setLogin(event.target.value)}
        />
        <div className="flex gap-2">
          <Input
            type="password"
            autoComplete="off"
            aria-label="API password"
            placeholder={saved ? "Replace API password" : "API password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button
            type="submit"
            disabled={
              save.isPending || !login.trim() || password.trim().length < 8
            }
          >
            {save.isPending ? "Checking…" : "Save"}
          </Button>
        </div>
      </form>
    </CardShell>
  );
}

function LlmCard({
  saved,
  onChange,
}: {
  saved:
    | (Saved & {
        accountId: string | null;
        modelFast: string | null;
        modelSmart: string | null;
      })
    | undefined;
  onChange: () => void;
}) {
  const initial: LlmProvider =
    saved && isLlmProvider(saved.provider) ? saved.provider : "anthropic";
  const [provider, setProvider] = useState<LlmProvider>(initial);
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState(saved?.accountId ?? "");
  const [modelFast, setModelFast] = useState(saved?.modelFast ?? "");
  const [modelSmart, setModelSmart] = useState(saved?.modelSmart ?? "");
  const save = useSaveKey(onChange, () => setApiKey(""));
  const info = LLM_PROVIDER_INFO[provider];
  return (
    <CardShell
      title="AI provider"
      description={`Powers the chat assistant and prompt and website research. ${info.keyHelp}.`}
      saved={saved}
      kind="llm"
      onChange={onChange}
    >
      <div className="space-y-2">
        <select
          aria-label="AI provider"
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          value={provider}
          onChange={(event) => {
            const next = event.target.value;
            if (isLlmProvider(next)) setProvider(next);
          }}
        >
          {LLM_PROVIDERS.map((id) => (
            <option key={id} value={id}>
              {LLM_PROVIDER_INFO[id].label}
            </option>
          ))}
        </select>
        {info.needsAccountId ? (
          <Input
            aria-label="Account id"
            placeholder="Cloudflare account id"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          />
        ) : null}
        <Input
          aria-label="Fast model"
          placeholder={`Fast model (${info.fastModel})`}
          value={modelFast}
          onChange={(event) => setModelFast(event.target.value)}
        />
        <Input
          aria-label="Smart model"
          placeholder={`Smart model (${info.smartModel})`}
          value={modelSmart}
          onChange={(event) => setModelSmart(event.target.value)}
        />
        <KeyForm
          placeholder={saved ? "Replace key" : "Paste key"}
          apiKey={apiKey}
          setApiKey={setApiKey}
          pending={save.isPending}
          onSubmit={() =>
            save.mutate({
              kind: "llm",
              provider,
              apiKey,
              accountId,
              modelFast,
              modelSmart,
            })
          }
        />
      </div>
    </CardShell>
  );
}
