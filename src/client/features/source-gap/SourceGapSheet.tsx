import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { SourceGapPanel } from "./SourceGapPanel";

export function SourceGapSheet({
  projectId,
  promptId,
  prompt,
  open,
  onOpenChange,
}: {
  projectId: string;
  promptId: string;
  prompt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="pr-8 whitespace-pre-wrap">{prompt}</SheetTitle>
          <SheetDescription>
            Source Gap Analysis: why the pages cited for this prompt won.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {open ? (
            <SourceGapPanel projectId={projectId} promptId={promptId} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
