import {
  Link,
  linkOptions,
  useRouter,
  type LinkOptions,
  type NavigateOptions,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Globe, Search, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { projectContextQueryKey } from "@/client/features/projects/project-context/shared";
import { getProjectContext } from "@/serverFunctions/projectContext";

export const OPEN_COMMAND_PALETTE_EVENT = "caldrin:open-command-palette";

type Row = {
  key: string;
  label: string;
  hint: string;
  icon?: LucideIcon;
  options: LinkOptions;
};

// Anything with a dot and no spaces is treated as a domain or URL.
function toDomain(text: string): string | null {
  const candidate = text.trim().replace(/^https?:\/\//i, "");
  if (/\s/.test(candidate) || !candidate.includes(".")) return null;
  const host = candidate.split(/[/?#]/)[0]?.replace(/^www\./i, "");
  return host && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? host : null;
}

function destinationRows(projectId: string): Row[] {
  const params = { projectId };
  return [
    {
      label: "Dashboard",
      hint: "Overview",
      options: linkOptions({ to: "/p/$projectId", params }),
    },
    {
      label: "Keywords & SERPs",
      hint: "Research",
      options: linkOptions({
        to: "/p/$projectId/keywords",
        params,
        search: {},
      }),
    },
    {
      label: "Saved keywords",
      hint: "Research",
      options: linkOptions({ to: "/p/$projectId/saved", params }),
    },
    {
      label: "Site Explorer",
      hint: "Research",
      options: linkOptions({
        to: "/p/$projectId/domain",
        params,
        search: {},
      }),
    },
    {
      label: "Keyword gap",
      hint: "Research",
      options: linkOptions({ to: "/p/$projectId/keyword-gap", params }),
    },
    {
      label: "Competitors",
      hint: "Research",
      options: linkOptions({ to: "/p/$projectId/competitors", params }),
    },
    {
      label: "Backlinks",
      hint: "Research",
      options: linkOptions({
        to: "/p/$projectId/backlinks",
        params,
        search: {},
      }),
    },
    {
      label: "Brand in AI answers",
      hint: "Research",
      options: linkOptions({ to: "/p/$projectId/brand-lookup", params }),
    },
    {
      label: "Organic Search: Search Console",
      hint: "Monitor",
      options: linkOptions({
        to: "/p/$projectId/search-performance",
        params,
      }),
    },
    {
      label: "Organic Search: Rank tracking",
      hint: "Monitor",
      options: linkOptions({ to: "/p/$projectId/rank-tracking", params }),
    },
    {
      label: "AI Search: Visibility",
      hint: "Monitor",
      options: linkOptions({
        to: "/p/$projectId/ai-visibility/insights",
        params,
      }),
    },
    {
      label: "AI Search: Prompt tracking",
      hint: "Monitor",
      options: linkOptions({ to: "/p/$projectId/ai-visibility", params }),
    },
    {
      label: "AI Search: Prompt research",
      hint: "Monitor",
      options: linkOptions({
        to: "/p/$projectId/ai-visibility/research",
        params,
      }),
    },
    {
      label: "AI Search: Prompt explorer",
      hint: "Monitor",
      options: linkOptions({ to: "/p/$projectId/prompt-explorer", params }),
    },
    {
      label: "AI Search: Citation gaps",
      hint: "Monitor",
      options: linkOptions({
        to: "/p/$projectId/ai-visibility/citations",
        params,
      }),
    },
    {
      label: "Local Search",
      hint: "Monitor",
      options: linkOptions({ to: "/p/$projectId/local-seo", params }),
    },
    {
      label: "Site Audit",
      hint: "Monitor",
      options: linkOptions({ to: "/p/$projectId/audit", params }),
    },
    {
      label: "Opportunities",
      hint: "Act",
      options: linkOptions({ to: "/p/$projectId/opportunities", params }),
    },
    {
      label: "Content Studio",
      hint: "Act",
      options: linkOptions({ to: "/p/$projectId/content", params }),
    },
    {
      label: "Workflows & Changes",
      hint: "Act",
      options: linkOptions({ to: "/p/$projectId/changes", params }),
    },
    {
      label: "Reports",
      hint: "Workspace",
      options: linkOptions({ to: "/p/$projectId/reports", params }),
    },
    {
      label: "Attribution",
      hint: "Monitor",
      options: linkOptions({ to: "/p/$projectId/attribution", params }),
    },
    {
      label: "Alerts",
      hint: "Workspace",
      options: linkOptions({ to: "/p/$projectId/alerts", params }),
    },
    {
      label: "Project Settings",
      hint: "Workspace",
      options: linkOptions({ to: "/p/$projectId/settings", params }),
    },
    {
      label: "Integrations",
      hint: "Project Settings",
      options: linkOptions({
        to: "/p/$projectId/settings/integrations",
        params,
      }),
    },
    {
      label: "Project context",
      hint: "Project Settings",
      options: linkOptions({ to: "/p/$projectId/settings/context", params }),
    },
    {
      label: "Usage & Limits",
      hint: "Project Settings",
      options: linkOptions({ to: "/p/$projectId/settings/limits", params }),
    },
  ].map((item) => ({
    ...item,
    key: `go-${item.label.replace(/\W+/g, "-")}`,
  }));
}

/**
 * Jump to any page, research a keyword, or open a domain or saved competitor.
 * Opening it reads nothing from a provider; a provider is only asked once a
 * research row is chosen, the same as running that search by hand.
 */
export function CommandPalette({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    };
  }, []);

  const context = useQuery({
    queryKey: projectContextQueryKey(projectId),
    queryFn: () => getProjectContext({ data: { projectId } }),
    enabled: open,
    staleTime: 60_000,
  });

  const rows = useMemo<Row[]>(() => {
    const params = { projectId };
    const destinations = destinationRows(projectId);

    const query = text.trim().toLowerCase();
    const matching = query
      ? destinations.filter((row) =>
          `${row.label} ${row.hint}`.toLowerCase().includes(query),
        )
      : destinations;

    let domainRow: Row | null = null;
    let keywordRow: Row | null = null;
    const domain = toDomain(text);
    if (domain) {
      domainRow = {
        key: "research-domain",
        label: `Explore ${domain} in Site Explorer`,
        hint: "Provider lookup",
        icon: Globe,
        options: linkOptions({
          to: "/p/$projectId/domain",
          params,
          search: { domain },
        }),
      };
    } else if (query) {
      keywordRow = {
        key: "research-keyword",
        label: `Research “${text.trim()}”`,
        hint: "Keywords & SERPs",
        icon: Search,
        options: linkOptions({
          to: "/p/$projectId/keywords",
          params,
          search: { q: text.trim() },
        }),
      };
    }

    const competitors = (context.data?.competitors ?? [])
      .filter(
        (competitor) =>
          !query ||
          `${competitor.domain} ${competitor.name ?? ""}`
            .toLowerCase()
            .includes(query),
      )
      .map<Row>((competitor) => ({
        key: `competitor-${competitor.id}`,
        label: competitor.name
          ? `${competitor.name} (${competitor.domain})`
          : competitor.domain,
        hint: "Competitor",
        icon: Globe,
        options: linkOptions({
          to: "/p/$projectId/domain",
          params,
          search: { domain: competitor.domain },
        }),
      }));

    // A page name that matches outranks a keyword search, so Enter never
    // starts a provider lookup the person did not type a keyword for.
    return [
      ...(domainRow ? [domainRow] : []),
      ...competitors,
      ...matching,
      ...(keywordRow ? [keywordRow] : []),
    ].slice(0, 30);
  }, [text, context.data, projectId]);

  const selected = Math.min(active, Math.max(rows.length - 1, 0));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setText("");
          setActive(0);
        }
      }}
    >
      <DialogContent showCloseButton={false} className="gap-2 p-2 sm:max-w-lg">
        <DialogTitle className="sr-only">Search and jump</DialogTitle>
        <DialogDescription className="sr-only">
          Type a keyword, a domain or a page name.
        </DialogDescription>
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="command-palette-list"
          aria-activedescendant={rows[selected]?.key}
          aria-label="Search keywords, domains, competitors and pages"
          placeholder="Keyword, domain, competitor or page…"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive(Math.min(selected + 1, rows.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive(Math.max(selected - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const row = rows[selected];
              if (!row) return;
              setOpen(false);
              setText("");
              setActive(0);
              void router.navigate(row.options as NavigateOptions);
            }
          }}
          className="h-10 w-full rounded-lg bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <ul
          id="command-palette-list"
          role="listbox"
          className="max-h-80 overflow-y-auto border-t pt-1"
        >
          {rows.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing matches.
            </li>
          ) : (
            rows.map((row, index) => {
              const Icon = row.icon;
              return (
                <li key={row.key} role="presentation">
                  <Link
                    {...row.options}
                    id={row.key}
                    role="option"
                    aria-selected={index === selected}
                    onMouseMove={() => setActive(index)}
                    onClick={() => {
                      setOpen(false);
                      setText("");
                      setActive(0);
                    }}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                  >
                    {Icon ? (
                      <Icon className="size-4 shrink-0" aria-hidden />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {row.hint}
                    </span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
