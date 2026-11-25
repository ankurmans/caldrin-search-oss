import { createFileRoute } from "@tanstack/react-router";
import {
  helpLinkClassName,
  SecretHelpPage,
} from "@/client/features/help/SecretHelpPage";
import { pageHead } from "@/client/lib/pageHead";

const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys";

export const Route = createFileRoute("/_app/help/openrouter-api-key")({
  head: () => pageHead("OpenRouter API key"),
  component: OpenrouterApiKeyHelpPage,
});

function OpenrouterApiKeyHelpPage() {
  const accountStep = (
    <li>
      Create an account at{" "}
      <a
        className={helpLinkClassName}
        href="https://openrouter.ai"
        target="_blank"
        rel="noreferrer"
      >
        openrouter.ai
      </a>{" "}
      and add credits (pay-as-you-go, like DataForSEO).
    </li>
  );
  const keyStep = (
    <li>
      Go to{" "}
      <a
        className={helpLinkClassName}
        href={OPENROUTER_KEYS_URL}
        target="_blank"
        rel="noreferrer"
      >
        OpenRouter API Keys
      </a>{" "}
      and click "Create API Key".
    </li>
  );
  return (
    <SecretHelpPage
      title="Set up your OpenRouter API key"
      intro={
        <>
          Caldrin Search needs the <code>OPENROUTER_API_KEY</code> secret before
          AI features like SAM, the in-app SEO agent, can run. It is optional —
          everything else in Caldrin Search works without it.
        </>
      }
      secretName="OPENROUTER_API_KEY"
      steps={
        <>
          {accountStep}
          {keyStep}
          <li>
            Save the key as the <code>OPENROUTER_API_KEY</code> secret in your
            environment:
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Cloudflare: set it in the Workers UI (see below)</li>
              <li>
                Local development: <code>.env.local</code>
              </li>
            </ul>
          </li>
          <li>Restart Caldrin Search.</li>
        </>
      }
      dashboardPasteStep="Paste your OpenRouter API key and save."
      terminalPromptHint="Paste your OpenRouter API key when prompted."
    />
  );
}
