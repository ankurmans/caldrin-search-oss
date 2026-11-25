import { describe, expect, it } from "vitest";
import { canAccessProject, roleSeesAllProjects } from "@/lib/org-permissions";

describe("project access", () => {
  it("lets owner, admin and member roles see every project", () => {
    expect(roleSeesAllProjects("owner")).toBe(true);
    expect(roleSeesAllProjects("admin")).toBe(true);
    expect(roleSeesAllProjects("member")).toBe(true);
  });

  it("limits scoped and unknown roles to granted projects", () => {
    expect(roleSeesAllProjects("scoped")).toBe(false);
    expect(roleSeesAllProjects("mystery")).toBe(false);
  });

  it("allows only listed projects when a list is set", () => {
    expect(canAccessProject(null, "p1")).toBe(true);
    expect(canAccessProject(["p1"], "p1")).toBe(true);
    expect(canAccessProject(["p1"], "p2")).toBe(false);
    expect(canAccessProject([], "p1")).toBe(false);
  });
});
