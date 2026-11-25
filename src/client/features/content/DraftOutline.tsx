import type { Editor } from "@tiptap/react";

export function DraftOutline({ editor }: { editor: Editor | null }) {
  const outline: { position: number; title: string }[] = [];
  editor?.state.doc.descendants((node, position) => {
    if (node.type.name === "heading" && node.textContent.trim())
      outline.push({ position: position + 1, title: node.textContent });
  });
  if (outline.length === 0) return null;
  return (
    <details className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">Outline</summary>
      <ol className="mt-2 space-y-1">
        {outline.map((item) => (
          <li key={item.position}>
            <button
              type="button"
              className="text-left text-sm underline decoration-border underline-offset-4"
              onClick={() =>
                editor
                  ?.chain()
                  .focus()
                  .setTextSelection(item.position)
                  .scrollIntoView()
                  .run()
              }
            >
              {item.title}
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}
