// One-time move of the local SQLite data into a fresh, empty bookie Cloud
// company (bookie-server POST /api/import). Reads the local file directly
// (getLocalDb, also in cloud mode) and never writes to it. Local ids only link
// rows inside the document; the server assigns new ones. Issued invoices go
// over as stored (number, totals, issuer snapshot), the server does not
// recompute them. Rows go over as SELECT *: the server picks the columns it
// knows and ignores the rest (company_id, timestamps, s3_key, ...).

import { api, CloudError } from "$lib/cloud";
import { getLocalDb } from "$lib/db/connection";
import {
  readOrganizationSettings,
  saveOrganizationSettings,
} from "$lib/db/settings";

type Row = Record<string, unknown>;
type Db = { select<T>(sql: string, params?: unknown[]): Promise<T> };

export type ImportDocument = {
  settings?: Row;
  vat_taxes: Row[];
  customers: Row[];
  projects: Row[];
  time_entries: Row[];
  invoices: Row[];
};
export type ImportCounts = {
  vat_taxes: number;
  customers: number;
  projects: number;
  time_entries: number;
  invoices: number;
};

/** Not on the server yet, so not transferred. */
export const SKIPPED = [
  "Eingangsrechnungen und ihre Belegdateien",
  "Wiederkehrende Buchungen",
  "S3-Backup-Einstellungen",
];

const byInvoice = (rows: Row[]) => {
  const m = new Map<unknown, Row[]>();
  for (const r of rows) {
    if (!m.has(r.invoice_id)) m.set(r.invoice_id, []);
    m.get(r.invoice_id)!.push(r);
  }
  return m;
};

/** The local data of the first company (the one the app shows) as an import document. */
export async function buildImport(db: Db): Promise<ImportDocument> {
  const sel = (sql: string, params: unknown[] = []) =>
    db.select<Row[]>(sql, params);
  const [company] = await sel("SELECT id FROM companies ORDER BY name LIMIT 1");
  const cid = company?.id ?? null;
  const [inv] = await sel("SELECT * FROM settings_invoice WHERE id = 1");
  // Locale, e-invoice and DATEV keys live in settings_organization locally.
  const [org] = await sel("SELECT * FROM settings_organization WHERE id = 1");
  const items = byInvoice(
    await sel(
      `SELECT ii.* FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.company_id = $1 ORDER BY ii.position, ii.id`,
      [cid],
    ),
  );
  const payments = byInvoice(
    await sel(
      `SELECT p.* FROM payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE i.company_id = $1 ORDER BY p.payment_date, p.id`,
      [cid],
    ),
  );
  const history = byInvoice(
    await sel(
      `SELECT h.* FROM invoice_status_history h JOIN invoices i ON i.id = h.invoice_id
       WHERE i.company_id = $1 ORDER BY h.changed_at, h.id`,
      [cid],
    ),
  );
  const rows = (table: string) =>
    sel(`SELECT * FROM ${table} WHERE company_id = $1 ORDER BY id`, [cid]);

  return {
    settings: inv || org ? { ...inv, ...org } : undefined,
    vat_taxes: await sel("SELECT * FROM vat_taxes ORDER BY id"),
    customers: await rows("customers"),
    // Server keeps money in cents; the desktop has euros in hourly_rate.
    projects: (await rows("projects")).map(({ hourly_rate, ...p }) => ({
      ...p,
      hourly_rate_cents:
        hourly_rate == null ? null : Math.round(Number(hourly_rate) * 100),
    })),
    time_entries: await rows("time_entries"),
    // By id: a storno comes after the invoice it references.
    invoices: (await rows("invoices")).map((i) => ({
      ...i,
      items: items.get(i.id) ?? [],
      payments: payments.get(i.id) ?? [],
      status_history: history.get(i.id) ?? [],
    })),
  };
}

export const countsOf = (d: ImportDocument): ImportCounts => ({
  vat_taxes: d.vat_taxes.length,
  customers: d.customers.length,
  projects: d.projects.length,
  time_entries: d.time_entries.length,
  invoices: d.invoices.length,
});

export const readLocalImport = async () => buildImport(await getLocalDb());

export async function pushImport(doc: ImportDocument): Promise<ImportCounts> {
  try {
    return await api<ImportCounts>("/api/import", "POST", doc);
  } catch (e) {
    if (e instanceof CloudError && e.status === 413)
      throw new Error(
        "Die lokalen Daten sind zu groß für eine Übertragung (max. 1 MB). Bitte den Support kontaktieren.",
      );
    throw e;
  }
}

/** Company master data (address, bank, tax ids) via the existing cloud save. */
export const pushOrganization = async () =>
  saveOrganizationSettings(await readOrganizationSettings(await getLocalDb()));
