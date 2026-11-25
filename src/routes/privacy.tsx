import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/client/features/legal/LegalPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/privacy")({
  head: () => pageHead("Privacy"),
  component: Page,
});

function Page() {
  return (
    <LegalPage title="Privacy">
      <p>
        This installation of the Caldrin Search open edition stores its data in
        the administrator's own Cloudflare account. The software does not send
        analytics or usage data to its authors unless the administrator
        configures a telemetry service. Provider keys are saved per workspace
        and are used only to call the providers you choose. Ask your
        administrator how long data is kept and how to export or delete it.
      </p>
    </LegalPage>
  );
}
