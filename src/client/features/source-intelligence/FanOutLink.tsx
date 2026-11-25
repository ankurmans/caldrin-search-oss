import { Link } from "@tanstack/react-router";
import type { z } from "zod";
import type { sourceSearchSchema } from "@/types/schemas/source-intelligence";

export function FanOutLink({
  projectId,
  ...filters
}: Omit<z.infer<typeof sourceSearchSchema>, "view" | "by"> & {
  projectId: string;
}) {
  return (
    <Link
      to="/p/$projectId/ai-visibility/sources"
      params={{ projectId }}
      search={{ ...filters, view: "queries", by: "prompt" }}
      className="text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-current"
    >
      View query fan-out
    </Link>
  );
}
