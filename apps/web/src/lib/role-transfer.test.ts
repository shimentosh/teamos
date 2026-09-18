import { describe, expect, it } from "vitest";
import {
  buildRolesFile,
  type Permissions,
  planRolesImport,
  RolesFileError,
} from "./role-transfer";

const existing: { role: string; permission: Permissions }[] = [
  { role: "member", permission: { task: ["read", "create"] } },
  { role: "hr", permission: { invitation: ["create"] } },
];

describe("roles file", () => {
  it("round-trips an export", () => {
    const file = JSON.stringify(buildRolesFile(existing, "Acme"));
    const plan = planRolesImport(file, existing);
    expect(plan.map((r) => [r.name, r.action])).toEqual([
      ["member", "unchanged"],
      ["hr", "unchanged"],
    ]);
  });

  it("plans creates and updates, dropping unknown permissions", () => {
    const file = JSON.stringify({
      format: "teamos.roles",
      version: 1,
      roles: [
        { name: "Member", permissions: { task: ["read"] } },
        {
          name: "designer",
          permissions: { task: ["read", "teleport"], spaceship: ["fly"] },
        },
        { name: "owner", permissions: { task: ["read"] } },
        { name: "<script>", permissions: { task: ["read"] } },
      ],
    });
    const plan = planRolesImport(file, existing);
    expect(plan).toEqual([
      {
        name: "member",
        action: "update",
        permissions: { task: ["read"] },
        dropped: [],
      },
      {
        name: "designer",
        action: "create",
        permissions: { task: ["read"] },
        dropped: ["task:teleport", "spaceship:fly"],
      },
    ]);
  });

  it("rejects files that aren't roles files", () => {
    expect(() => planRolesImport("nope", existing)).toThrow(RolesFileError);
    expect(() => planRolesImport('{"roles":[]}', existing)).toThrow(
      "notRolesFile",
    );
    expect(() =>
      planRolesImport('{"format":"teamos.roles","roles":[]}', existing),
    ).toThrow("noRoles");
  });
});
