import { cloud, resource } from "$lib/cloud";
import { getDb, safeFields } from "./connection";
import type { Project } from "./types";

type CreateProject = Omit<Project, "id" | "created_at" | "updated_at">;
type UpdateProject = Partial<CreateProject>;

const ALLOWED_COLUMNS = [
  "company_id",
  "customer_id",
  "project_number",
  "name",
  "description",
  "status",
  "hourly_rate",
  "starts_on",
  "ends_on",
] as const;

// The server keeps money in cents (and hides the rate from members without a
// finance grant); the desktop schema has euros in hourly_rate.
type RemoteProject = Omit<Project, "hourly_rate"> & {
  hourly_rate_cents?: number | null;
};
const remote = resource<RemoteProject>("projects");
const fromRemote = ({ hourly_rate_cents, ...p }: RemoteProject): Project => ({
  ...p,
  hourly_rate: hourly_rate_cents == null ? null : hourly_rate_cents / 100,
});
const toRemote = ({ hourly_rate, ...p }: UpdateProject) =>
  hourly_rate === undefined
    ? p
    : {
        ...p,
        hourly_rate_cents:
          hourly_rate == null ? null : Math.round(hourly_rate * 100),
      };

export async function listProjects(companyId: number): Promise<Project[]> {
  if (cloud()) return (await remote.list()).map(fromRemote);
  const db = await getDb();
  return db.select(
    "SELECT * FROM projects WHERE company_id = $1 ORDER BY name",
    [companyId],
  );
}

export async function getProjectById(id: number): Promise<Project | undefined> {
  if (cloud()) {
    const p = await remote.get(id);
    return p && fromRemote(p);
  }
  const db = await getDb();
  const rows = await db.select<Project[]>(
    "SELECT * FROM projects WHERE id = $1",
    [id],
  );
  return rows[0];
}

export async function createProject(data: CreateProject): Promise<number> {
  if (cloud()) return remote.create(toRemote(data));
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO projects (company_id, customer_id, project_number, name, description, status, hourly_rate, starts_on, ends_on)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      data.company_id,
      data.customer_id,
      data.project_number,
      data.name,
      data.description,
      data.status,
      data.hourly_rate,
      data.starts_on,
      data.ends_on,
    ],
  );
  return result.lastInsertId!;
}

export async function updateProject(
  id: number,
  data: UpdateProject,
): Promise<void> {
  if (cloud()) return remote.update(id, toRemote(data));
  const fields = safeFields(data, ALLOWED_COLUMNS);
  if (fields.length === 0) return;

  const sets = fields.map(([key], i) => `${key} = $${i + 1}`);
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  const values = fields.map(([, v]) => v);
  values.push(id);

  const db = await getDb();
  await db.execute(
    `UPDATE projects SET ${sets.join(", ")} WHERE id = $${values.length}`,
    values,
  );
}

export async function deleteProject(id: number): Promise<void> {
  if (cloud()) return remote.remove(id);
  const db = await getDb();
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
}
