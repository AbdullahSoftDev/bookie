import { test, expect } from "bun:test";
import "./setup";
import * as companies from "../../src/lib/db/companies";
import * as customers from "../../src/lib/db/customers";
import * as invoices from "../../src/lib/db/invoices";
import { testDb } from "./setup";

// Migration 0032: invoices.buyer_reference (E-Rechnung BT-10) is stored,
// editable on drafts and frozen once the invoice is issued.

let n = 0;
async function newInvoice(buyerReference?: string | null) {
  const companyId = await companies.createCompany({
    name: `Co-${++n}`,
    legal_name: null,
    street: null,
    postal_code: null,
    city: null,
    country_code: "DE",
    tax_number: null,
    vat_id: null,
    bank_account_holder: null,
    bank_iban: null,
    bank_bic: null,
    bank_name: null,
  });
  const customerId = await customers.createCustomer({
    company_id: companyId,
    customer_number: null,
    name: "Cu",
    contact_name: null,
    email: null,
    phone: null,
    street: null,
    postal_code: null,
    city: null,
    country_code: "DE",
    vat_id: null,
    website: null,
    type: "kunde",
  });
  return invoices.createInvoice({
    company_id: companyId,
    customer_id: customerId,
    project_id: null,
    invoice_number: `BR-${n}`,
    status: "draft",
    issue_date: "2026-05-01",
    due_date: null,
    service_period_start: null,
    service_period_end: null,
    currency: "EUR",
    net_cents: 0,
    tax_cents: 0,
    gross_cents: 0,
    issuer_name: null,
    issuer_tax_number: null,
    issuer_vat_id: null,
    issuer_bank_account_holder: null,
    issuer_bank_iban: null,
    issuer_bank_bic: null,
    issuer_bank_name: null,
    recipient_name: null,
    recipient_street: null,
    recipient_postal_code: null,
    recipient_city: null,
    recipient_country_code: null,
    delivery_date: null,
    due_surcharge: 0,
    language: "de",
    legal_country_code: "DE",
    notes: null,
    s3_key: null,
    buyer_reference: buyerReference,
  });
}

test("buyer_reference is stored, updatable on drafts, null when omitted", async () => {
  const id = await newInvoice("04011000-12345-34");
  expect((await invoices.getInvoiceById(id))?.buyer_reference).toBe(
    "04011000-12345-34",
  );
  await invoices.updateInvoice(id, { buyer_reference: "PO-7" });
  expect((await invoices.getInvoiceById(id))?.buyer_reference).toBe("PO-7");
  const other = await newInvoice();
  expect((await invoices.getInvoiceById(other))?.buyer_reference).toBeNull();
});

test("buyer_reference is frozen by the immutability trigger once issued", async () => {
  const id = await newInvoice("A");
  await invoices.updateInvoiceStatus(id, "draft", "issued");
  await expect(
    testDb.execute("UPDATE invoices SET buyer_reference = 'B' WHERE id = $1", [
      id,
    ]),
  ).rejects.toThrow(/invoice_immutable/);
});
