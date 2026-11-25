import { createFileRoute, redirect } from "@tanstack/react-router";

// Context now lives in project settings. Agents and bookmarks still use this
// URL, so it redirects rather than 404s.
export const Route = createFileRoute("/_app/p/$projectId/context")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/p/$projectId/settings/context",
      params: { projectId: params.projectId },
      replace: true,
    });
  },
});
