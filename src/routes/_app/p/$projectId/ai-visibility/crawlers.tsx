import { createFileRoute, redirect } from "@tanstack/react-router";

// The page moved to Technical SEO; older links still land on it.
export const Route = createFileRoute(
  "/_app/p/$projectId/ai-visibility/crawlers",
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/p/$projectId/technical/ai-crawlers",
      params: { projectId: params.projectId },
      replace: true,
    });
  },
});
