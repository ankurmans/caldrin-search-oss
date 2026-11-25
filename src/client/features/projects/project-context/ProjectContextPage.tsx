import * as React from "react";
import { InlineConfirm } from "@/client/components/InlineConfirm";
import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { QueryState } from "@/client/components/QueryState";
import { getProjectContext } from "@/serverFunctions/projectContext";
import { PROSE_MAX_CHARS } from "@/types/schemas/projectContext";
import { BrandNameSection } from "./BrandNameSection";
import { CompetitorsSection } from "./CompetitorsSection";
import { ProseSections } from "./ProseSections";
import { KeyPagesSection } from "./KeyPagesSection";
import {
  listClass,
  Provenance,
  RowActions,
  projectContextQueryKey,
  useContextUpdate,
  type ProjectContextData,
} from "./shared";
import { EmptyState } from "@/client/components/EmptyState";
import { FormActions } from "@/client/components/FormActions";
import { SectionHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";

export function ProjectContextPage({ projectId }: { projectId: string }) {
  const contextQuery = useQuery({
    queryKey: projectContextQueryKey(projectId),
    queryFn: () => getProjectContext({ data: { projectId } }),
    // This page exists to inspect what agents just wrote; the app-wide
    // 5-minute staleTime would show pre-SAM-turn memory as current.
    staleTime: 0,
  });

  return (
    <QueryState
      query={contextQuery}
      errorFallback="Failed to load project context"
    >
      {(context) => (
        // key remounts the whole page when the project switches under it, so no
        // draft, open form, or edit state can carry over to another project.
        <div key={projectId} className="space-y-8">
          <p className="text-sm text-muted-foreground">
            What Claude Code and any other connected MCP client know about this
            project. They read it before they work and write back what they
            learn, so correct anything that looks wrong.
          </p>

          <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="space-y-8">
              <BrandNameSection
                projectId={projectId}
                brandName={context.brandName}
              />

              <ProseSections
                projectId={projectId}
                sections={context.sections}
                missingSections={context.missingSections}
              />
            </div>
            <div className="space-y-8">
              <CompetitorsSection
                projectId={projectId}
                competitors={context.competitors}
              />

              <KeyPagesSection
                projectId={projectId}
                keyPages={context.keyPages}
              />

              <CustomSections
                projectId={projectId}
                customSections={context.customSections}
              />

              <ResearchLog
                projectId={projectId}
                researchLog={context.researchLog}
              />
            </div>
          </div>
        </div>
      )}
    </QueryState>
  );
}

function CustomSections({
  projectId,
  customSections,
}: {
  projectId: string;
  customSections: ProjectContextData["customSections"];
}) {
  const update = useContextUpdate(projectId);
  const [editingSlug, setEditingSlug] = React.useState<string | null>(null);

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Custom sections"
        hint="Anything an agent wrote down that didn't fit the sections above."
      />

      {customSections.length === 0 ? (
        <EmptyState
          size="sm"
          icon={null}
          title="Nothing here yet"
          description="Agents add a section when they learn something important that has nowhere else to live."
        />
      ) : (
        <div className="space-y-3">
          {customSections.map((custom) =>
            editingSlug === custom.slug ? (
              <CustomSectionForm
                key={custom.slug}
                custom={custom}
                pending={update.isPending}
                onCancel={() => setEditingSlug(null)}
                onSave={(title, content) =>
                  update.mutate(
                    [{ customSection: custom.slug, title, content }],
                    { onSuccess: () => setEditingSlug(null) },
                  )
                }
              />
            ) : (
              <div
                key={custom.slug}
                className="space-y-2 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium">
                      {custom.title ?? custom.slug}
                    </h3>
                    <Provenance by={custom.updatedBy} at={custom.updatedAt} />
                  </div>
                  <RowActions>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit ${custom.title ?? custom.slug}`}
                      onClick={() => setEditingSlug(custom.slug)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <InlineConfirm
                      label={`Delete ${custom.title ?? custom.slug}`}
                      pending={update.isPending}
                      onConfirm={() =>
                        update.mutate([{ deleteCustomSection: custom.slug }])
                      }
                    />
                  </RowActions>
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {custom.content}
                </p>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function CustomSectionForm({
  custom,
  pending,
  onCancel,
  onSave,
}: {
  custom: ProjectContextData["customSections"][number];
  pending: boolean;
  onCancel: () => void;
  onSave: (title: string, content: string) => void;
}) {
  const [title, setTitle] = React.useState(custom.title ?? "");
  const [content, setContent] = React.useState(custom.content);

  return (
    <form
      className="space-y-2 rounded-lg border border-border bg-muted/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || !content.trim()) return;
        onSave(title.trim() || custom.slug, content);
      }}
    >
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={custom.slug}
        maxLength={120}
        aria-label="Section title"
      />
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={5}
        maxLength={PROSE_MAX_CHARS}
        aria-label="Section content"
      />
      <FormActions
        pending={pending}
        disabled={!content.trim()}
        onCancel={onCancel}
        size="xs"
      />
    </form>
  );
}

function ResearchLog({
  projectId,
  researchLog,
}: {
  projectId: string;
  researchLog: ProjectContextData["researchLog"];
}) {
  const update = useContextUpdate(projectId);

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Research log"
        hint="What's already been looked up, so nobody buys the same data twice."
      />

      {researchLog.length === 0 ? (
        <EmptyState
          size="sm"
          icon={null}
          title="Nothing logged yet"
          description="Agents record paid research here as they run it."
        />
      ) : (
        <ul className={listClass}>
          {researchLog.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-3 p-3"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm text-foreground">{entry.summary}</p>
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <span>{entry.entryDate}</span>
                  <Provenance by={entry.createdBy} />
                </div>
              </div>
              <RowActions>
                <InlineConfirm
                  label={`Delete log entry from ${entry.entryDate}`}
                  pending={update.isPending}
                  onConfirm={() =>
                    update.mutate([{ removeResearchLog: [entry.id] }])
                  }
                />
              </RowActions>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
