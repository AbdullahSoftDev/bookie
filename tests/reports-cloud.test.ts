import { afterAll, expect, test } from "bun:test";
import { getActionItems, getDashboardData } from "$lib/db/dashboard";
import { getEuerData, getEuerReport, getUstvaData } from "$lib/db/tax-reports";
import { getDatevBookingRows } from "$lib/db/datev";

const saved = {
  localStorage: (globalThis as any).localStorage,
  fetch: globalThis.fetch,
};
afterAll(() => Object.assign(globalThis, saved));
const paths: string[] = [];
(globalThis as any).localStorage = {
  getItem: () => JSON.stringify({ url: "http://s", token: "t", email: "e" }),
  removeItem: () => {},
};
globalThis.fetch = (async (url: string) => {
  paths.push(url.slice("http://s".length));
  return new Response(
    JSON.stringify({ revenue: [1], costs: [2], actions: { drafts: 3 } }),
  );
}) as any;

test("reports call the server's report routes with the desktop's year/period args", async () => {
  expect(await getDashboardData(1, 2025, "quarter")).toEqual({
    revenue: [1],
    costs: [2],
  } as any);
  expect(await getActionItems(1)).toEqual({ drafts: 3 } as any);
  await getUstvaData(1, 2025, "month");
  await getEuerData(1, 2025, "year");
  await getEuerReport(1, "2025-02-01", "2025-03-31");
  await getDatevBookingRows(1, 2025);
  expect(paths).toEqual([
    "/api/reports/dashboard?year=2025&groupBy=quarter",
    `/api/reports/dashboard?year=${new Date().getFullYear()}&groupBy=year`,
    "/api/reports/ustva?from=2025-01-01&to=2025-12-31&groupBy=month",
    "/api/reports/euer?year=2025&groupBy=year",
    "/api/reports/euer-report?from=2025-02-01&to=2025-03-31",
    "/api/reports/datev-bookings?from=2025-01-01&to=2025-12-31",
  ]);
});
