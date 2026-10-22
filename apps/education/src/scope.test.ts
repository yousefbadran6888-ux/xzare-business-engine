import { it, expect } from "vitest";
import { scopeLost, visible } from "./scope";
it("clears cached teacher groups and roster views when assignment is removed", () => {
  const a = {
      user: { role: "teacher" },
      groups: [{ id: "g1" }],
      students: [{ id: "s1" }],
    },
    b = { ...a, groups: [], students: [] };
  expect(scopeLost(a as any, b as any)).toBe(true);
  expect(visible(b as any, "group", "g1")).toBe(false);
  expect(visible(b as any, "student", "s1")).toBe(false);
});
it("privilege downgrade clears cached financial forms even if the group stays visible", () => {
  const a = { user: { role: "admin" }, groups: [{ id: "g1" }], students: [] },
    b = { ...a, user: { role: "teacher" } };
  expect(scopeLost(a as any, b as any)).toBe(true);
});
