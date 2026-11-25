import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { PageHeader } from "@/client/components/PageHeader";
import { AuditHistorySection } from "@/client/features/audit/launch/AuditHistorySection";
import { LaunchFormCard } from "@/client/features/audit/launch/LaunchFormCard";
import { useLaunchController } from "@/client/features/audit/launch/useLaunchController";

type LaunchViewProps = {
  projectId: string;
  initialUrl: string;
  onAuditStarted: (auditId: string) => void;
};

export function LaunchView({
  projectId,
  initialUrl,
  onAuditStarted,
}: LaunchViewProps) {
  const controller = useLaunchController({
    projectId,
    initialUrl,
    onAuditStarted,
  });

  return (
    <div className="px-4 py-4 md:px-6 md:py-6 pb-24 md:pb-8 overflow-auto">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader title="Site Audit" />

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <LaunchFormCard
            launchForm={controller.launchForm}
            commitMaxPagesInput={controller.commitMaxPagesInput}
            maxPagesLimit={controller.maxPagesLimit}
            canRenderJavaScript={controller.canRenderJavaScript}
            trialEnded={controller.trialEnded}
          />

          <AuditHistorySection
            projectId={projectId}
            historyQuery={controller.historyQuery}
            onDelete={controller.deleteAudit}
          />
        </div>

        {controller.largeCrawlPages != null ? (
          <LargeCrawlDialog
            pages={controller.largeCrawlPages}
            onConfirm={controller.confirmLargeCrawl}
            onClose={controller.cancelLargeCrawl}
          />
        ) : null}
      </div>
    </div>
  );
}

function LargeCrawlDialog({
  pages,
  onConfirm,
  onClose,
}: {
  pages: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      title="Start a large audit?"
      confirmLabel="Continue"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      {`You are about to crawl ${pages.toLocaleString()} pages. This is okay, but it may take a while. Continue?`}
    </ConfirmDialog>
  );
}
