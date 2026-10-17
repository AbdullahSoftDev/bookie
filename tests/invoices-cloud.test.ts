import { afterAll, afterEach, expect, test } from "bun:test";
import {
  canChangeStatus,
  cancelInvoice,
  createInvoice,
  createInvoiceFromTimeEntries,
  getInvoiceById,
  listAllInvoices,
  syncInvoiceItems,
  updateInvoice,
  updateInvoiceStatus,
} from "$lib/db/invoices";
import { listByInvoice } from "$lib/db/invoice-items";
import { createPayment, deletePayment } from "$lib/db/payments";
import { hourlyRatePatch, listProjects, updateProject } from "$lib/db/projects";

const saved = {
  localStorage: (globalThis as any).localStorage,
  fetch: globalThis.fetch,
};
afterAll(() => Object.assign(globalThis, saved));
const calls: { path: string; method: string; body?: any }[] = [];
const routes: Record<string, [number, unknown]> = {};
(globalThis as any).localStorage = {
  getItem: () => JSON.stringify({ url: "http://s", token: "t", email: "e" }),
  removeItem: () => {},
};
globalThis.fetch = (async (url: string, init: RequestInit) => {
  const path = url.slice("http://s".length);
  const method = init.method ?? "GET";
  calls.push({
    path,
    method,
    body: init.body ? JSON.parse(String(init.body)) : undefined,
  });
  const [status, body] = routes[`${method} ${path}`] ?? [200, { ok: true }];
  return new Response(JSON.stringify(body), { status });
}) as any;
afterEach(() => (calls.length = 0));

const header = {
  company_id: 1,
  customer_id: 7,
  project_id: null,
  invoice_number: "RE-2026-0001",
  status: "draft",
  issue_date: "2026-10-16",
  due_date: "2026-10-30",
  service_period_start: null,
  service_period_end: null,
  buyer_reference: null,
  currency: "EUR",
  net_cents: 10000,
  tax_cents: 1900,
  gross_cents: 11900,
  issuer_name: "ACME",
  issuer_tax_number: null,
  issuer_vat_id: null,
  issuer_bank_account_holder: null,
  issuer_bank_iban: null,
  issuer_bank_bic: null,
  issuer_bank_name: null,
  recipient_name: "",
  recipient_street: null,
  recipient_postal_code: null,
  recipient_city: null,
  recipient_country_code: null,
  notes: null,
  s3_key: null,
  language: "de",
  legal_country_code: "DE",
  delivery_date: "2026-10-16",
  due_surcharge: 0,
};

test("create sends only client-owned header fields, items without totals, then issue", async () => {
  routes["POST /api/invoices"] = [201, { id: 42, status: "draft" }];
  const id = await createInvoice(header);
  expect(id).toBe(42);
  await syncInvoiceItems(id, [
    {
      position: 1,
      description: "Beratung",
      quantity: 1.5,
      unit: "Stk",
      unit_price_net_cents: 8000, // 80,00 € stays cents: no second ×100
      tax_rate: 19,
      line_total_net_cents: 12000,
    },
  ]);
  routes["POST /api/invoices/42/issue"] = [
    200,
    { id: 42, status: "sent", invoice_number: "RE-2026-0007", items: [] },
  ];
  await updateInvoiceStatus(42, "draft", "sent");

  const [post, patch, issue] = calls;
  expect(post).toMatchObject({ method: "POST", path: "/api/invoices" });
  for (const k of [
    "invoice_number",
    "status",
    "net_cents",
    "tax_cents",
    "gross_cents",
    "issuer_name",
    "company_id",
    "s3_key",
  ])
    expect(k in post.body).toBe(false);
  expect(post.body).toMatchObject({ customer_id: 7, recipient_name: "" });

  expect(patch).toMatchObject({ method: "PATCH", path: "/api/invoices/42" });
  expect(patch.body).toEqual({
    items: [
      {
        position: 1,
        description: "Beratung",
        quantity: 1.5,
        unit: "Stk",
        unit_price_net_cents: 8000,
        tax_rate: 19,
      },
    ],
  });
  expect(issue).toMatchObject({
    method: "POST",
    path: "/api/invoices/42/issue",
  });
});

test("other status moves go to /status; only allowed ones are offered", async () => {
  await updateInvoiceStatus(5, "sent", "paid");
  expect(calls[0]).toMatchObject({
    path: "/api/invoices/5/status",
    body: { status: "paid" },
  });
  expect(canChangeStatus("draft", "sent")).toBe(true);
  expect(canChangeStatus("draft", "paid")).toBe(false);
  expect(canChangeStatus("paid", "draft")).toBe(false);
  expect(canChangeStatus("void", "sent")).toBe(false);
  expect(canChangeStatus("void", "void")).toBe(true);
});

test("reads hide the draft placeholder number and split items off", async () => {
  routes["GET /api/invoices?limit=50&offset=0"] = [
    200,
    {
      rows: [
        {
          id: 1,
          status: "draft",
          invoice_number: "draft-abc",
          customer_name: "X",
        },
        { id: 2, status: "sent", invoice_number: "RE-1", customer_name: "Y" },
      ],
      totalCount: 2,
    },
  ];
  const page = await listAllInvoices({ limit: 50 });
  expect(page.totalCount).toBe(2);
  expect(page.rows.map((r) => r.invoice_number)).toEqual(["", "RE-1"]);

  const item = { id: 9, invoice_id: 2, position: 1, unit_price_net_cents: 500 };
  routes["GET /api/invoices/2"] = [
    200,
    { id: 2, status: "sent", invoice_number: "RE-1", items: [item] },
  ];
  const inv = await getInvoiceById(2);
  expect(inv && "items" in inv).toBe(false);
  expect((await listByInvoice(2)).rows).toEqual([item] as any);
  routes["GET /api/invoices/3"] = [404, { error: "not_found" }];
  expect(await getInvoiceById(3)).toBeUndefined();
});

test("s3_key-only update sends nothing; storno and payments use nested routes", async () => {
  await updateInvoice(1, { s3_key: "x.pdf" });
  expect(calls).toEqual([]);

  routes["POST /api/invoices/2/storno"] = [201, { id: 3 }];
  expect(await cancelInvoice(2, "Falscher Betrag")).toBe(3);
  expect(calls[0].body).toEqual({ reason: "Falscher Betrag" });

  routes["POST /api/invoices/2/payments"] = [201, { id: 11 }];
  const pid = await createPayment({
    invoice_id: 2,
    payment_date: "2026-10-16",
    amount_cents: 11900,
    method: null,
    reference: null,
    note: null,
  });
  expect(pid).toBe(11);
  expect(calls[1].body).toEqual({
    payment_date: "2026-10-16",
    amount_cents: 11900,
    method: null,
    reference: null,
    note: null,
  });
  await deletePayment(11, 2);
  expect(calls[2]).toMatchObject({
    method: "DELETE",
    path: "/api/invoices/2/payments/11",
  });
  await expect(deletePayment(11)).rejects.toThrow("invoiceId");
});

test("from-time-entries posts only the set filters and returns the draft id", async () => {
  routes["POST /api/invoices/from-time-entries"] = [201, { id: 77 }];
  expect(
    await createInvoiceFromTimeEntries({
      customer_id: 7,
      project_id: null,
      from: "2026-09-01",
      to: "",
    }),
  ).toBe(77);
  expect(calls[0]).toEqual({
    method: "POST",
    path: "/api/invoices/from-time-entries",
    body: { customer_id: 7, from: "2026-09-01" },
  });
  routes["POST /api/invoices/from-time-entries"] = [
    400,
    { error: "no_entries" },
  ];
  await expect(
    createInvoiceFromTimeEntries({ customer_id: 7 }),
  ).rejects.toMatchObject({ code: "no_entries" });
});

test("a hidden hourly rate is marked on read and never sent back on save", async () => {
  routes["GET /api/projects"] = [
    200,
    [
      { id: 1, name: "A" }, // rate omitted: member without finance grant
      { id: 2, name: "B", hourly_rate_cents: null },
      { id: 3, name: "C", hourly_rate_cents: 8550 },
    ],
  ];
  const [a, b, c] = await listProjects(1);
  expect([a.hourly_rate_hidden, b.hourly_rate_hidden, c.hourly_rate]).toEqual([
    true,
    undefined,
    85.5,
  ]);
  calls.length = 0;
  await updateProject(1, { name: "A2", ...hourlyRatePatch(a, null) });
  await updateProject(3, { ...hourlyRatePatch(c, 90) });
  expect(calls[0].body).toEqual({ name: "A2" });
  expect(calls[1].body).toEqual({ hourly_rate_cents: 9000 });
});
