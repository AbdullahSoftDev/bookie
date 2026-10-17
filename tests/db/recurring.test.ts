import { expect, test } from "bun:test";
import "./setup";
import * as companies from "../../src/lib/db/companies";
import {
  createRecurring,
  deleteRecurring,
  listRecurring,
  updateRecurring,
} from "../../src/lib/db/recurring";

test("local list / edit / delete of recurring schedules", async () => {
  const companyId = await companies.createCompany({
    name: "Co", legal_name: null, street: null, postal_code: null, city: null,
    country_code: "DE", tax_number: null, vat_id: null,
    bank_account_holder: null, bank_iban: null, bank_bic: null, bank_name: null,
  });
  const base = {
    company_id: companyId, kind: "incoming" as const, frequency: "monthly" as const,
    interval_count: 1, end_date: null, payload: { net_cents: 100 },
  };
  const late = await createRecurring({ ...base, label: "Miete", next_run_date: "2026-12-01" });
  const soon = await createRecurring({ ...base, label: "Abo", next_run_date: "2026-11-01" });
  expect((await listRecurring()).map((r) => r.id)).toEqual([soon, late]);

  await updateRecurring(late, {
    label: "Büro", frequency: "quarterly", interval_count: 2, next_run_date: "2026-10-01",
    end_date: "2027-12-31", active: 0,
    // Not an editable column: must be ignored, not written.
    ...({ company_id: 999 } as object),
  });
  const [first] = await listRecurring();
  expect(first).toMatchObject({
    id: late, label: "Büro", frequency: "quarterly", interval_count: 2,
    next_run_date: "2026-10-01", end_date: "2027-12-31", active: 0, company_id: companyId,
  });
  expect(JSON.parse(first.payload)).toEqual({ net_cents: 100 }); // untouched

  await deleteRecurring(soon);
  expect((await listRecurring()).map((r) => r.id)).toEqual([late]);
});
