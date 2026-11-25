import type { ProjectSummary } from "./types";

export type ProjectSection = {
  key: string;
  label: string;
  projects: ProjectSummary[];
};

/**
 * The switcher's order: a Starred section first, then one section per group in
 * the order the groups first appear, then everything ungrouped. A starred
 * project shows only under Starred. Input is already in manual order.
 */
export function sectionProjects(projects: ProjectSummary[]): ProjectSection[] {
  const sections: ProjectSection[] = [];
  const starred = projects.filter((project) => project.starred);
  if (starred.length > 0) {
    sections.push({ key: "starred", label: "Starred", projects: starred });
  }
  const groups = new Map<string, ProjectSummary[]>();
  const ungrouped: ProjectSummary[] = [];
  for (const project of projects) {
    if (project.starred) continue;
    if (!project.groupName) {
      ungrouped.push(project);
      continue;
    }
    const members = groups.get(project.groupName) ?? [];
    members.push(project);
    groups.set(project.groupName, members);
  }
  for (const [name, members] of groups) {
    sections.push({ key: `group:${name}`, label: name, projects: members });
  }
  if (ungrouped.length > 0) {
    sections.push({
      key: "ungrouped",
      label: sections.length > 0 ? "Other" : "Projects",
      projects: ungrouped,
    });
  }
  return sections;
}

/** The whole list as organize items, numbered in its current order. */
export function toOrganizeItems(projects: ProjectSummary[]) {
  return projects.map((project, index) => ({
    id: project.id,
    sortOrder: index + 1,
    starred: project.starred,
    groupName: project.groupName,
  }));
}
