export interface DiffRow {
  left: string | null;
  right: string | null;
  kind: "same" | "changed" | "removed" | "added";
}

const lines = (text: string) => text.replace(/\r/g, "").split("\n");

/**
 * Lines of the original beside lines of the edit. A run of removed lines and a
 * run of added lines at the same spot are paired into changed rows, so a
 * reworded paragraph reads as one row.
 */
export function diffRows(original: string, edited: string): DiffRow[] {
  const a = lines(original);
  const b = lines(edited);
  const table = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);

  const rows: DiffRow[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    const count = Math.max(removed.length, added.length);
    for (let k = 0; k < count; k++) {
      const left = removed[k] ?? null;
      const right = added[k] ?? null;
      rows.push({
        left,
        right,
        kind:
          left !== null && right !== null
            ? "changed"
            : left !== null
              ? "removed"
              : "added",
      });
    }
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      rows.push({ left: a[i], right: b[j], kind: "same" });
      i++;
      j++;
    } else if (
      j >= b.length ||
      (i < a.length && table[i + 1][j] >= table[i][j + 1])
    ) {
      removed.push(a[i++]);
    } else {
      added.push(b[j++]);
    }
  }
  flush();
  return rows;
}
