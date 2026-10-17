import { afterEach, expect, test } from "bun:test";
import { buildImport, countsOf } from "$lib/cloud-import";
import { createTestDb, type TestDb } from "./db/harness";

let db: TestDb;
afterEach(() => db?.close());

test("buildImport: first company only, cents mapping, items/payments/history nested, storno after original", async () => {
  db = createTestDb();
  db.raw.exec(`
    INSERT INTO companies (id, name, country_code) VALUES (1, 'Zeta', 'DE'), (2, 'Alpha', 'DE');
    INSERT INTO customers (id, company_id, name, country_code, type) VALUES (10, 2, 'Kunde', 'DE', 'kunde'), (11, 1, 'Fremd', 'DE', 'kunde');
    INSERT INTO projects (id, company_id, customer_id, name, status, hourly_rate) VALUES (20, 2, 10, 'P', 'active', 90.5), (21, 2, 10, 'Q', 'active', NULL);
    INSERT INTO time_entries (id, company_id, customer_id, project_id, entry_date, duration_minutes, billable) VALUES (30, 2, 10, 20, '2026-03-12', 90, 1);
    INSERT INTO invoices (id, company_id, customer_id, invoice_number, status, issue_date, currency, net_cents, tax_cents, gross_cents, issuer_name, language, legal_country_code)
      VALUES (40, 2, 10, 'RE-2026-0001', 'sent', '2026-03-31', 'EUR', 13575, 2579, 16154, 'Alt GmbH', 'de', 'DE');
    INSERT INTO invoice_items (invoice_id, project_id, time_entry_id, position, description, quantity, unit, tax_rate, unit_price_net_cents, line_total_net_cents)
      VALUES (40, 20, 30, 1, 'Beratung', 1.5, 'h', 19, 9050, 13575);
    INSERT INTO payments (invoice_id, payment_date, method, amount_cents) VALUES (40, '2026-04-10', 'transfer', 5000);
    INSERT INTO invoice_status_history (invoice_id, from_status, to_status, changed_at) VALUES (40, NULL, 'draft', '2026-03-30 10:00:00'), (40, 'draft', 'sent', '2026-03-31 10:00:00');
    INSERT INTO invoices (id, company_id, customer_id, invoice_number, status, issue_date, currency, net_cents, tax_cents, gross_cents, references_invoice_id, cancellation_reason, language, legal_country_code)
      VALUES (41, 2, 10, 'RE-2026-0001-storno-1', 'sent', '2026-04-01', 'EUR', -13575, -2579, -16154, 40, 'Fehler', 'de', 'DE');
    INSERT INTO vat_taxes (name, description, goods_value_percent) VALUES ('USt 19', '', 19);
    INSERT INTO incoming_invoices (id, company_id, supplier_id, invoice_date, status, net_cents, tax_cents, gross_cents, local_path)
      VALUES (50, 2, 10, '2026-02-01', 'offen', 100, 19, 119, '/x.pdf'), (51, 1, 11, '2026-02-01', 'offen', 1, 0, 1, NULL);
    INSERT INTO recurring_entries (id, company_id, kind, label, frequency, interval_count, next_run_date, payload)
      VALUES (60, 2, 'incoming', 'Miete', 'monthly', 1, '2026-11-01', '{"supplier_id":10}');
    INSERT OR REPLACE INTO settings_invoice (id, currency, decimal_places, days_till_due, due_surcharge, notes, invoice_number_format, invoice_number_incrementor)
      VALUES (1, 'EUR', 2, 14, 0, '', 'RE-{YYYY}-{COUNT}', 13);
  `);

  const doc = await buildImport(db);
  expect(countsOf(doc)).toEqual({
    vat_taxes: 1,
    customers: 1,
    projects: 2,
    time_entries: 1,
    invoices: 2,
    incoming_invoices: 1,
    recurring_entries: 1,
  });
  expect(doc.incoming_invoices[0]).toMatchObject({
    id: 50,
    supplier_id: 10,
    gross_cents: 119,
  });
  expect(doc.recurring_entries[0]).toMatchObject({
    kind: "incoming",
    payload: '{"supplier_id":10}',
  });
  expect(doc.customers[0]).toMatchObject({ id: 10, name: "Kunde" }); // company 'Alpha' sorts first
  expect(doc.projects.map((p) => p.hourly_rate_cents)).toEqual([9050, null]);
  expect(doc.projects[0]).not.toHaveProperty("hourly_rate");
  expect(doc.time_entries[0]).toMatchObject({
    id: 30,
    project_id: 20,
    customer_id: 10,
    duration_minutes: 90,
  });
  expect(doc.settings).toMatchObject({
    invoice_number_incrementor: 13,
    invoice_number_format: "RE-{YYYY}-{COUNT}",
  });

  const [inv, storno] = doc.invoices as any[];
  expect(inv).toMatchObject({
    id: 40,
    invoice_number: "RE-2026-0001",
    status: "sent",
    net_cents: 13575,
    gross_cents: 16154,
    issuer_name: "Alt GmbH",
  });
  expect(inv.items).toEqual([
    expect.objectContaining({
      project_id: 20,
      time_entry_id: 30,
      quantity: 1.5,
      unit_price_net_cents: 9050,
      line_total_net_cents: 13575,
    }),
  ]);
  expect(inv.payments).toEqual([
    expect.objectContaining({ payment_date: "2026-04-10", amount_cents: 5000 }),
  ]);
  expect(inv.status_history.map((h: any) => h.to_status)).toEqual([
    "draft",
    "sent",
  ]);
  expect(storno).toMatchObject({
    id: 41,
    references_invoice_id: 40,
    items: [],
    payments: [],
  });
});

test("buildImport: empty local db gives empty lists", async () => {
  db = createTestDb();
  const doc = await buildImport(db);
  expect(countsOf(doc)).toEqual({
    vat_taxes: 0,
    customers: 0,
    projects: 0,
    time_entries: 0,
    invoices: 0,
    incoming_invoices: 0,
    recurring_entries: 0,
  });
});
