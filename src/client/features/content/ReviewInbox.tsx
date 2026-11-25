import { CardShell } from "@/client/components/CardShell";
import { Button } from "@/client/components/ui/button";

export function ReviewInbox({
  drafts,
  onOpen,
}: {
  drafts: { id: string; title: string }[];
  onOpen: (id: string) => void;
}) {
  return (
    <CardShell title="My reviews">
      {drafts.length ? (
        <ul className="divide-y">
          {drafts.map((draft) => (
            <li
              key={draft.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span className="min-w-0 break-words font-medium">
                {draft.title}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpen(draft.id)}
                aria-label={`Review ${draft.title}`}
              >
                Review draft
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No drafts awaiting your review.
        </p>
      )}
    </CardShell>
  );
}
