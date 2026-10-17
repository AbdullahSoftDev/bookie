// Cloud team management (bookie-server src/api/members.ts). Money goes over
// the wire in cents; the UI works in euros.

import { api } from "$lib/cloud";

export type Role = "admin" | "member" | "subcontractor";

// Must match Area in bookie-server src/types.ts.
export const AREAS = [
  "invoices",
  "incoming_invoices",
  "reports",
  "recurring",
  "team_time",
  "settings",
] as const;
export type Area = (typeof AREAS)[number];
export type Grant = { area: Area; level: "view" | "edit" };

export type TeamMember = {
  user_id: number;
  name: string;
  email: string;
  role: Role;
  cost_rate_cents: number | null;
  created_at: string;
  grants: Grant[];
};

export type SubcontractorRow = {
  user_id: number;
  user_name: string;
  project_id: number | null;
  project_name: string | null;
  minutes: number;
  approved_minutes: number;
  cost_cents: number;
  revenue_cents: number;
};

/** Euro input ("12,50", 12.5; empty = none) -> whole cents. */
export function toCents(eur: string | number | null): number | null {
  if (eur == null || String(eur).trim() === "") return null;
  const n = Number(String(eur).trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error("Ungültiger Betrag");
  return Math.round(n * 100);
}

export const invite = (
  email: string,
  role: "member" | "subcontractor",
  costRateEur: string | number | null = null,
) =>
  api<{ id: number }>("/api/invitations", "POST", {
    email,
    role,
    cost_rate_cents: role === "subcontractor" ? toCents(costRateEur) : null,
  });

/** Takes the bare token or the whole invite link (…/invite?token=…). */
export const acceptInvitation = (tokenOrLink: string) =>
  api<{ companyId: number }>("/api/invitations/accept", "POST", {
    token: tokenOrLink.trim().replace(/^.*[?&]token=/, ""),
  });

export const listMembers = () => api<TeamMember[]>("/api/members");

export const setCostRate = (userId: number, eur: string | number | null) =>
  api(`/api/members/${userId}`, "PATCH", { cost_rate_cents: toCents(eur) });

/** member <-> subcontractor; becoming a subcontractor drops all grants. */
export const setRole = (userId: number, role: "member" | "subcontractor") =>
  api(`/api/members/${userId}`, "PATCH", { role });

/** Replaces all grants of a member (not admin, not subcontractor). */
export const setGrants = (userId: number, grants: Grant[]) =>
  api(`/api/members/${userId}/grants`, "PUT", { grants });

export const removeMember = (userId: number) =>
  api(`/api/members/${userId}`, "DELETE");

export const listAssignments = (projectId: number) =>
  api<number[]>(`/api/projects/${projectId}/assignments`);

export const assign = (projectId: number, userId: number) =>
  api(`/api/projects/${projectId}/assignments`, "POST", { user_id: userId });

export const unassign = (projectId: number, userId: number) =>
  api(`/api/projects/${projectId}/assignments/${userId}`, "DELETE");

/** month = "YYYY-MM" */
export const approveMonth = (userId: number, month: string) =>
  api<{ approved: number }>("/api/time-entries/approve", "POST", {
    user_id: userId,
    month,
  });

export const unapproveMonth = (userId: number, month: string) =>
  api<{ unapproved: number }>("/api/time-entries/approve", "DELETE", {
    user_id: userId,
    month,
  });

export const subcontractorReport = (month: string) =>
  api<SubcontractorRow[]>(
    `/api/reports/subcontractors?month=${encodeURIComponent(month)}`,
  );
