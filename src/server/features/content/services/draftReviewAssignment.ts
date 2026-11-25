import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { getAllowedProjectIds } from "@/server/auth/project-access";
import { ContentRefusal } from "../rules/contentRefusal";
import {
  listProjectReviewers,
  updateDraftReviewer,
} from "../repositories/DraftReviewRepository";
import type { Scope } from "./shopifyConnection";

export async function assignDraftReviewer(
  scope: Scope,
  assetId: string,
  reviewer: string | null,
) {
  if (reviewer) {
    const membership = await AuthRepository.getMembership(
      reviewer,
      scope.organizationId,
    );
    if (!membership)
      throw new ContentRefusal("Choose a teammate who can open this project.");
    const projects = await getAllowedProjectIds(
      reviewer,
      scope.organizationId,
      membership.role,
    );
    if (projects && !projects.includes(scope.projectId))
      throw new ContentRefusal("Choose a teammate who can open this project.");
  }
  if (!(await updateDraftReviewer(scope.projectId, assetId, reviewer)))
    throw new ContentRefusal(
      "Open a saved, unpublished draft before assigning a reviewer.",
    );
}

export function getProjectDraftReviewers(scope: Scope) {
  return listProjectReviewers(scope.projectId, scope.organizationId);
}
