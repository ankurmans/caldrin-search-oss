import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/client/features/legal/LegalPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/terms")({
  head: () => pageHead("Terms"),
  component: Page,
});

function Page() {
  return (
    <LegalPage title="Terms">
      <p>
        The Caldrin Search open edition is software that you or your
        organization installs and runs. This installation is operated by its
        administrator, who sets the terms for people who use it. The software is
        provided under the licence in the repository, without warranty. Ask your
        administrator for the terms that apply to you.
      </p>
    </LegalPage>
  );
}
