/**
 * Pre-flight check for outgoing e-invoices. Runs on the data BEFORE the XML is
 * written and reports what the user can fix (missing seller VAT ID, wrong
 * totals, bad IBAN, ...). Rule ids are the EN 16931 / XRechnung business rules
 * they correspond to. It is a subset: the authoritative check is the KoSIT /
 * Mustangproject run in tests/lib/pdf/einvoice-validator.test.ts.
 */
import {
  taxCategoryFor,
  type InvoiceXmlData,
  type XmlInvoiceFormat,
} from "$lib/pdf/invoice-xml";

export interface EInvoiceIssue {
  severity: "error" | "warning";
  /** What is wrong: field absent, field malformed, numbers disagree, not supported. */
  code: "missing" | "invalid" | "mismatch" | "unsupported";
  /** Dotted path into InvoiceXmlData, e.g. "seller.vatId". */
  field: string;
  /** EN 16931 / XRechnung rule this maps to. */
  rule: string;
}

const isBlank = (v: string | undefined | null) => !v || !v.trim();

export function isValidIsoDate(s: string | undefined | null): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (
    d.getUTCFullYear() === +m[1] &&
    d.getUTCMonth() === +m[2] - 1 &&
    d.getUTCDate() === +m[3]
  );
}

/** ISO 13616 mod-97 check. Spaces are ignored. */
export function isValidIban(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const digits = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + +ch) % 97;
  return rem === 1;
}

const VAT_ID = /^[A-Z]{2}[A-Z0-9+*.]{2,12}$/;
const near = (a: number, b: number) => Math.abs(a - b) <= 1; // one cent of rounding

export function validateInvoiceXmlData(
  d: InvoiceXmlData,
  format: XmlInvoiceFormat,
): EInvoiceIssue[] {
  const out: EInvoiceIssue[] = [];
  const err = (code: EInvoiceIssue["code"], field: string, rule: string) =>
    out.push({ severity: "error", code, field, rule });
  const warn = (code: EInvoiceIssue["code"], field: string, rule: string) =>
    out.push({ severity: "warning", code, field, rule });
  const xr = format === "xrechnung";

  // --- Document ---
  if (isBlank(d.invoiceNumber)) err("missing", "invoiceNumber", "BR-2");
  if (!isValidIsoDate(d.issueDate))
    err(isBlank(d.issueDate) ? "missing" : "invalid", "issueDate", "BR-3");
  if (!/^[A-Z]{3}$/.test(d.currency ?? ""))
    err(isBlank(d.currency) ? "missing" : "invalid", "currency", "BR-5");
  if (isBlank(d.dueDate)) err("missing", "dueDate", "BR-CO-25");
  else if (!isValidIsoDate(d.dueDate)) err("invalid", "dueDate", "BR-CO-25");
  if (xr && isBlank(d.buyerReference))
    err("missing", "buyerReference", "BR-DE-15");

  // --- Seller ---
  const s = d.seller;
  if (isBlank(s.name)) err("missing", "seller.name", "BR-6");
  if (isBlank(s.street)) err("missing", "seller.street", "§14 UStG");
  if (isBlank(s.city)) err("missing", "seller.city", "BR-DE-3");
  if (isBlank(s.postalCode)) err("missing", "seller.postalCode", "BR-DE-4");
  if (!/^[A-Z]{2}$/.test(s.countryCode ?? ""))
    err(
      isBlank(s.countryCode) ? "missing" : "invalid",
      "seller.countryCode",
      "BR-9",
    );
  if (isBlank(s.vatId) && isBlank(s.taxNumber))
    err("missing", "seller.vatId", "BR-CO-26");
  if (!isBlank(s.vatId) && !VAT_ID.test(s.vatId!.replace(/\s+/g, "")))
    err("invalid", "seller.vatId", "BR-CO-9");
  if (!isBlank(s.bankIban) && !isValidIban(s.bankIban!))
    err("invalid", "seller.bankIban", "BR-61");
  if (
    !isBlank(s.bankBic) &&
    !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s.bankBic!.replace(/\s+/g, ""))
  )
    warn("invalid", "seller.bankBic", "BT-86");
  if (isBlank(s.bankIban))
    (xr ? err : warn)("missing", "seller.bankIban", "BR-DE-1");
  if (xr) {
    if (isBlank(s.email)) err("missing", "seller.email", "BR-DE-7");
    if (isBlank(s.phone)) err("missing", "seller.phone", "BR-DE-6");
  }

  // --- Buyer ---
  const b = d.buyer;
  if (isBlank(b.name)) err("missing", "buyer.name", "BR-7");
  if (!/^[A-Z]{2}$/.test(b.countryCode ?? ""))
    err(
      isBlank(b.countryCode) ? "missing" : "invalid",
      "buyer.countryCode",
      "BR-11",
    );
  if (xr) {
    if (isBlank(b.city)) err("missing", "buyer.city", "BR-DE-8");
    if (isBlank(b.postalCode)) err("missing", "buyer.postalCode", "BR-DE-9");
    if (isBlank(b.email)) err("missing", "buyer.email", "PEPPOL-EN16931-R010");
  }
  if (!isBlank(b.vatId) && !VAT_ID.test(b.vatId!.replace(/\s+/g, "")))
    err("invalid", "buyer.vatId", "BR-CO-9");

  // --- Lines ---
  if (d.items.length === 0) err("missing", "items.list", "BR-16");
  d.items.forEach((it, i) => {
    const f = `items[${i}]`;
    if (isBlank(it.description)) err("missing", `${f}.description`, "BR-25");
    if (!Number.isFinite(it.quantity)) err("invalid", `${f}.quantity`, "BR-22");
    if (!Number.isInteger(it.unitPriceNetCents) || it.unitPriceNetCents < 0)
      err("invalid", `${f}.unitPrice`, "BR-27");
    if (!Number.isFinite(it.taxRate) || it.taxRate < 0 || it.taxRate > 100)
      err("invalid", `${f}.taxRate`, "BR-S-05");
    else if (
      !near(
        it.lineTotalNetCents,
        Math.round(it.quantity * it.unitPriceNetCents),
      )
    )
      err("mismatch", `${f}.lineTotal`, "BR-24");
  });

  // --- VAT breakdown ---
  const rates = new Set(d.items.map((it) => it.taxRate));
  for (const r of rates) {
    if (!d.taxGroups.some((g) => g.rate === r))
      err("missing", "taxGroups.group", "BR-S-01");
  }
  d.taxGroups.forEach((g, i) => {
    const f = `taxGroups[${i}]`;
    const cat = g.category ?? taxCategoryFor(g.rate);
    const lines = d.items.filter((it) => it.taxRate === g.rate);
    const net = lines.reduce((a, it) => a + it.lineTotalNetCents, 0);
    if (!near(g.netAmountCents, net)) err("mismatch", `${f}.net`, "BR-S-08");
    if (!near(g.amountCents, Math.round((g.netAmountCents * g.rate) / 100)))
      err("mismatch", `${f}.tax`, "BR-CO-17");
    if (cat === "S" && g.rate <= 0) err("invalid", `${f}.rate`, "BR-S-05");
    if (cat !== "S" && g.rate !== 0) err("invalid", `${f}.rate`, "BR-E-05");
    // E falls back to DEFAULT_EXEMPTION_REASON in the emitter; the others need an explicit reason.
    if (cat !== "S" && cat !== "E" && isBlank(g.exemptionReason))
      err("missing", `${f}.exemptionReason`, "BR-E-10");
    if (g.rate === 0) warn("unsupported", `${f}.rate`, "BR-E-10");
  });

  // --- Totals ---
  const sumLines = d.items.reduce((a, it) => a + it.lineTotalNetCents, 0);
  const sumTax = d.taxGroups.reduce((a, g) => a + g.amountCents, 0);
  if (!near(d.totals.netCents, sumLines))
    err("mismatch", "totals.net", "BR-CO-10");
  if (!near(d.totals.taxCents, sumTax))
    err("mismatch", "totals.tax", "BR-CO-14");
  if (!near(d.totals.grossCents, d.totals.netCents + d.totals.taxCents))
    err("mismatch", "totals.gross", "BR-CO-15");

  return out;
}

export const hasErrors = (issues: EInvoiceIssue[]) =>
  issues.some((i) => i.severity === "error");
