import type { ComponentProps, ReactNode } from "react";
import { createLink } from "@tanstack/react-router";
import { cn } from "cn";

/** A strip of router links styled as tabs, for pages with their own URL. */
export function NavTabs({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap gap-x-1 border-b border-border"
    >
      {children}
    </nav>
  );
}

// The router sets `data-status="active"` and `aria-current="page"` on the
// link that matches the current URL.
function NavTabAnchor({
  className,
  active,
  ...props
}: ComponentProps<"a"> & {
  /** Overrides the router's match for tabs that share one route. */
  active?: boolean;
}) {
  return (
    <a
      className={cn(
        "relative inline-flex h-9 items-center px-3 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 data-[status=active]:text-foreground",
        "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground after:opacity-0 data-[status=active]:after:opacity-100",
        className,
      )}
      {...props}
      {...(active === undefined
        ? {}
        : {
            "data-status": active ? "active" : undefined,
            "aria-current": active ? ("page" as const) : undefined,
          })}
    />
  );
}

export const NavTab = createLink(NavTabAnchor);
