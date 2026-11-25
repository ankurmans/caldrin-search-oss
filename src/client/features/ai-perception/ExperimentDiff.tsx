import { diffRows, type DiffRow } from "./diffRows";

const SIDE: Record<DiffRow["kind"], { left: string; right: string }> = {
  same: { left: "", right: "" },
  changed: {
    left: "bg-rose-50 dark:bg-rose-500/10",
    right: "bg-emerald-50 dark:bg-emerald-500/10",
  },
  removed: { left: "bg-rose-50 dark:bg-rose-500/10", right: "bg-muted/40" },
  added: { left: "bg-muted/40", right: "bg-emerald-50 dark:bg-emerald-500/10" },
};

/** The page as it stands beside the proposed edit, line by line. */
export function ExperimentDiff({
  original,
  edited,
}: {
  original: string;
  edited: string;
}) {
  const rows = diffRows(original, edited);
  const changed = rows.filter((r) => r.kind !== "same").length;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {changed
          ? `${changed} changed ${changed === 1 ? "line" : "lines"}`
          : "The edit matches the original."}
      </p>
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border text-sm max-md:grid-cols-1">
        <p className="border-b bg-muted/60 px-3 py-1.5 text-xs font-medium">
          Original
        </p>
        <p className="border-b bg-muted/60 px-3 py-1.5 text-xs font-medium max-md:hidden">
          Proposed edit
        </p>
        {rows.map((row, i) => (
          <div key={i} className="contents">
            <p
              className={`whitespace-pre-wrap break-words px-3 py-1 ${SIDE[row.kind].left}`}
            >
              {row.left ?? ""}
            </p>
            <p
              className={`whitespace-pre-wrap break-words px-3 py-1 ${SIDE[row.kind].right}`}
            >
              {row.right ?? ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
