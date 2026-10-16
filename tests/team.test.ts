import { afterAll, expect, test } from "bun:test";
import * as team from "$lib/team";

const saved = {
  localStorage: (globalThis as any).localStorage,
  fetch: globalThis.fetch,
};
afterAll(() => Object.assign(globalThis, saved));
const calls: { path: string; method: string; body?: any }[] = [];
(globalThis as any).localStorage = {
  getItem: () => JSON.stringify({ url: "http://s", token: "t", email: "e" }),
  removeItem: () => {},
};
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({
    path: url.slice("http://s".length),
    method: init.method ?? "GET",
    body: init.body ? JSON.parse(String(init.body)) : undefined,
  });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}) as any;

test("toCents parses German and plain euro input", () => {
  expect(team.toCents("55,50")).toBe(5550);
  expect(team.toCents(12.345)).toBe(1235);
  expect(team.toCents(" ")).toBeNull();
  expect(team.toCents(null)).toBeNull();
  expect(() => team.toCents("abc")).toThrow();
  expect(() => team.toCents("-1")).toThrow();
});

test("wrappers send the server's request shapes", async () => {
  await team.invite("a@b.de", "subcontractor", "50");
  await team.invite("c@b.de", "member", "50");
  await team.acceptInvitation("http://x/invite?token=abc");
  await team.setCostRate(7, "60,25");
  await team.setCostRate(7, "");
  await team.setRole(7, "subcontractor");
  await team.setGrants(7, [{ area: "invoices", level: "edit" }]);
  await team.removeMember(7);
  await team.assign(3, 7);
  await team.unassign(3, 7);
  await team.approveMonth(7, "2026-09");
  await team.unapproveMonth(7, "2026-09");
  await team.subcontractorReport("2026-09");
  expect(calls).toEqual([
    {
      path: "/api/invitations",
      method: "POST",
      body: { email: "a@b.de", role: "subcontractor", cost_rate_cents: 5000 },
    },
    {
      path: "/api/invitations",
      method: "POST",
      body: { email: "c@b.de", role: "member", cost_rate_cents: null },
    },
    { path: "/api/invitations/accept", method: "POST", body: { token: "abc" } },
    {
      path: "/api/members/7",
      method: "PATCH",
      body: { cost_rate_cents: 6025 },
    },
    {
      path: "/api/members/7",
      method: "PATCH",
      body: { cost_rate_cents: null },
    },
    {
      path: "/api/members/7",
      method: "PATCH",
      body: { role: "subcontractor" },
    },
    {
      path: "/api/members/7/grants",
      method: "PUT",
      body: { grants: [{ area: "invoices", level: "edit" }] },
    },
    { path: "/api/members/7", method: "DELETE", body: undefined },
    {
      path: "/api/projects/3/assignments",
      method: "POST",
      body: { user_id: 7 },
    },
    {
      path: "/api/projects/3/assignments/7",
      method: "DELETE",
      body: undefined,
    },
    {
      path: "/api/time-entries/approve",
      method: "POST",
      body: { user_id: 7, month: "2026-09" },
    },
    {
      path: "/api/time-entries/approve",
      method: "DELETE",
      body: { user_id: 7, month: "2026-09" },
    },
    {
      path: "/api/reports/subcontractors?month=2026-09",
      method: "GET",
      body: undefined,
    },
  ]);
});
