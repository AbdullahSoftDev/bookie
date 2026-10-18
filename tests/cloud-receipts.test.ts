import { afterAll, expect, mock, test } from "bun:test";
import { __setDbForTesting } from "$lib/db/connection";
import { createTestDb } from "./db/harness";

// Rust side: sizes per key, copy_receipt runs until the next tick.
const MB = 1024 * 1024;
const sizes: Record<string, number> = {};
let running = 0;
let peakRunning = 0;
const copied: string[] = [];
const presigned: number[] = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: any) => {
    if (cmd === "get_s3_credentials")
      return { accessKeyId: "a", secretAccessKey: "s" };
    if (cmd === "receipt_size") return sizes[args.source.key];
    if (cmd === "copy_receipt") {
      expect(args.size).toBe(sizes[args.source.key]); // signed Content-Length
      running++;
      peakRunning = Math.max(peakRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      copied.push(args.source.key);
      return;
    }
    throw new Error(`unmocked invoke: ${cmd}`);
  },
}));
const { pushReceipts } = await import("$lib/cloud-import");

const saved = {
  localStorage: (globalThis as any).localStorage,
  fetch: globalThis.fetch,
};
afterAll(() => {
  Object.assign(globalThis, saved);
  __setDbForTesting(null);
});
(globalThis as any).localStorage = {
  getItem: () => JSON.stringify({ url: "http://s", token: "t", email: "e" }),
  removeItem: () => {},
};

test("pushReceipts: at most 8 in flight, sizes go to presign and copy, large files too", async () => {
  const db = createTestDb();
  __setDbForTesting(db);
  const keys = Array.from({ length: 20 }, (_, i) => `r${i}.pdf`);
  keys.forEach((k, i) => (sizes[k] = i === 3 ? 900 * MB : 18 * MB));
  db.raw.exec(`
    INSERT INTO companies (id, name, country_code) VALUES (1, 'A', 'DE');
    INSERT INTO customers (id, company_id, name, country_code, type) VALUES (1, 1, 'L', 'DE', 'lieferant');
    INSERT OR REPLACE INTO settings_s3 (id, enabled, endpoint_url, region, bucket_name, path_prefix) VALUES (1, 1, 'https://e', 'r', 'b', '');
    ${keys.map((k, i) => `INSERT INTO incoming_invoices (id, company_id, supplier_id, invoice_date, status, net_cents, tax_cents, gross_cents, s3_key, file_name) VALUES (${i + 1}, 1, 1, '2026-01-${String(i + 1).padStart(2, "0")}', 'offen', 1, 0, 1, '${k}', '${k}');`).join("\n")}
  `);
  const remote = keys.map((_, i) => ({
    id: 100 + i,
    supplier_name: "L",
    invoice_date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    net_cents: 1,
    tax_cents: 0,
    s3_key: null,
  }));
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const path = url.slice("http://s".length);
    const body =
      path === "/api/incoming-invoices"
        ? remote
        : path.endsWith("/receipt-url") &&
            presigned.push(JSON.parse(String(init.body)).size)
          ? {
              url: "https://bucket/k?X-Amz-Signature=x",
              headers: { "content-type": "application/pdf" },
              invoice: { s3_key: "k" },
            }
          : { ok: true };
    expect(init.method === "POST" || path === "/api/incoming-invoices").toBe(
      true,
    );
    return new Response(JSON.stringify(body), { status: 200 });
  }) as any;

  const progress: number[] = [];
  const r = await pushReceipts((p) => progress.push(p.done));
  expect(r).toEqual({ done: 20, failed: [] });
  expect(copied.sort()).toEqual([...keys].sort());
  expect(presigned).toContain(900 * MB);
  expect(peakRunning).toBe(8);
  expect(progress.at(-1)).toBe(20);
});
