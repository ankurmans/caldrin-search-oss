import { Button } from "@/client/components/ui/button";
import type { DraftDetail } from "./helpers";

export function DraftVersions({
  detail,
  editable,
  onLoad,
}: {
  detail: DraftDetail;
  editable: boolean;
  onLoad: (version: DraftDetail["versions"][number]) => void;
}) {
  const { asset, versions } = detail;
  if (versions.length < 2) return null;
  return (
    <details className="rounded-lg border border-border p-3 text-xs">
      <summary className="cursor-pointer font-medium">
        Version history ({versions.length})
      </summary>
      <ul className="mt-2 divide-y">
        {versions.map((version) => (
          <li
            key={version.id}
            className="flex flex-wrap items-center justify-between gap-2 py-1"
          >
            <span>
              Revision {version.revision} · {version.createdAt}
              {version.revision === asset.revision ? " (current)" : ""}
              {asset.importedFrom && version.revision === 1
                ? " · Import baseline"
                : ""}
            </span>
            {editable && version.revision !== asset.revision ? (
              <Button size="sm" variant="ghost" onClick={() => onLoad(version)}>
                Load into editor
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
