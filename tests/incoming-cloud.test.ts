import { afterAll, afterEach, expect, mock, test } from "bun:test";

// The receipt PUT goes through Rust (put_presigned_url), recorded like a fetch.
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, body: Uint8Array, opts: any) => {
    const args = JSON.parse(decodeURIComponent(opts.headers["x-bookie-args"]));
    calls.push({
      url: args.url,
      method: cmd,
      headers: { "content-type": args.contentType },
      body,
    });
  },
}));
import {
  createIncomingInvoice,
  deleteIncomingInvoice,
  downloadReceipt,
  listIncomingInvoices,
  updateIncomingInvoice,
  updateIncomingInvoicePaidDate,
  updateIncomingInvoiceStatus,
  uploadReceipt,
} from "$lib/db/incoming-invoices";
import {
  createRecurring,
  runDueRecurring,
  snapshotIncoming,
} from "$lib/db/recurring";

const saved = {
  localStorage: (globalThis as any).localStorage,
  fetch: globalThis.fetch,
};
afterAll(() => Object.assign(globalThis, saved));
const calls: { url: string; method: string; body?: any; headers?: any }[] = [];
const routes: Record<string, [number, unknown]> = {};
(globalThis as any).localStorage = {
  getItem: () => JSON.stringify({ url: "http://s", token: "t", email: "e" }),
  removeItem: () => {},
};
globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
  const path = url.startsWith("http://s/") ? url.slice("http://s".length) : url;
  const method = init.method ?? "GET";
  calls.push({
    url: path,
    method,
    headers: init.headers,
    body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
  });
  if (path.startsWith("https://bucket/"))
    return new Response(method === "GET" ? new Uint8Array([1, 2, 3]) : null);
  const [status, body] = routes[`${method} ${path}`] ?? [200, { ok: true }];
  return new Response(JSON.stringify(body), { status });
}) as any;
afterEach(() => {
  calls.length = 0;
  for (const k in routes) delete routes[k];
});

const row = {
  company_id: 1,
  supplier_id: 3,
  invoice_number: "L-1",
  invoice_date: "2026-10-01",
  net_cents: 10000,
  tax_cents: 1900,
  status: "offen",
  file_name: "x.pdf",
  file_type: "application/pdf",
  s3_key: "local-key",
  local_path: "/tmp/x.pdf",
  notes: null,
};

test("CRUD sends only server-writable fields", async () => {
  routes["POST /api/incoming-invoices"] = [201, { id: 9 }];
  expect(await createIncomingInvoice(row)).toBe(9);
  expect(calls[0].body).toEqual({
    supplier_id: 3,
    invoice_number: "L-1",
    invoice_date: "2026-10-01",
    net_cents: 10000,
    tax_cents: 1900,
    status: "offen",
    notes: null,
  });

  await updateIncomingInvoice(9, {
    net_cents: 5,
    s3_key: "x",
    local_path: "y",
  });
  await updateIncomingInvoiceStatus(9, "bezahlt");
  await deleteIncomingInvoice(9);
  expect(calls.slice(1).map((c) => [c.method, c.url, c.body])).toEqual([
    ["PATCH", "/api/incoming-invoices/9", { net_cents: 5 }],
    ["PATCH", "/api/incoming-invoices/9", { status: "bezahlt" }],
    ["DELETE", "/api/incoming-invoices/9", undefined],
  ]);
});

test("list pages via limit/offset", async () => {
  routes["GET /api/incoming-invoices?limit=50&offset=100"] = [
    200,
    { rows: [{ id: 1 }], totalCount: 101 },
  ];
  expect(await listIncomingInvoices(1, { limit: 50, offset: 100 })).toEqual({
    rows: [{ id: 1 }],
    totalCount: 101,
  } as any);
});

test("paid date: validated locally, server not_paid maps to the local message", async () => {
  await expect(updateIncomingInvoicePaidDate(9, "1.10.2026")).rejects.toThrow(
    "Ungültiges Zahlungsdatum",
  );
  expect(calls).toEqual([]);
  routes["PATCH /api/incoming-invoices/9"] = [409, { error: "not_paid" }];
  await expect(updateIncomingInvoicePaidDate(9, "2026-10-02")).rejects.toThrow(
    "nur bei bezahlten",
  );
  expect(calls[0].body).toEqual({ paid_date: "2026-10-02" });
});

test("receipt: presign, PUT with the signed content-type, confirm; GET via presigned URL", async () => {
  routes["POST /api/incoming-invoices/9/receipt-url"] = [
    200,
    {
      url: "https://bucket/k?sig",
      headers: { "content-type": "application/pdf", "content-length": "4" },
      invoice: { s3_key: "companies/1/incoming/k" },
    },
  ];
  const file = new File([new Uint8Array(4)], "beleg.pdf", {
    type: "application/pdf",
  });
  await uploadReceipt(9, file);
  expect(calls[0].body).toEqual({
    content_type: "application/pdf",
    size: 4,
    file_name: "beleg.pdf",
  });
  expect(calls[1]).toMatchObject({
    url: "https://bucket/k?sig",
    method: "put_presigned_url",
    headers: { "content-type": "application/pdf" },
  });
  expect(calls[1].body).toEqual(new Uint8Array(4));
  expect(calls[2]).toMatchObject({
    url: "/api/incoming-invoices/9/receipt",
    method: "POST",
    body: { s3_key: "companies/1/incoming/k" },
  });

  routes["GET /api/incoming-invoices/9/receipt"] = [
    200,
    { url: "https://bucket/k?get" },
  ];
  expect(await downloadReceipt(9)).toEqual(new Uint8Array([1, 2, 3]));
});

test("recurring: snapshot from the server row, POST without company_id, no local runner", async () => {
  routes["GET /api/incoming-invoices/9"] = [200, { ...row, id: 9 }];
  routes["POST /api/recurring"] = [201, { id: 4 }];
  const snap = await snapshotIncoming(9);
  const id = await createRecurring({
    company_id: 1,
    kind: "incoming",
    label: snap.label,
    frequency: "monthly",
    interval_count: 1,
    next_run_date: "2026-11-01",
    end_date: null,
    payload: snap.payload,
  });
  expect(id).toBe(4);
  const body = calls.at(-1)!.body;
  expect(body.company_id).toBeUndefined();
  expect(body).toMatchObject({
    kind: "incoming",
    label: "L-1",
    next_run_date: "2026-11-01",
    payload: {
      supplier_id: 3,
      net_cents: 10000,
      tax_cents: 1900,
      s3_key: null,
    },
  });
  calls.length = 0;
  expect(await runDueRecurring(1, "2026-12-01")).toBe(0);
  expect(calls).toEqual([]);
});
