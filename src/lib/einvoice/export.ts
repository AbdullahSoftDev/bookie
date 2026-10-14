import { createInvoicePdfA3 } from "$lib/pdf/invoice-pdf-a3";
import type { InvoicePdfData } from "$lib/pdf/invoice-pdf";
import {
  renderInvoiceXml,
  type InvoiceXmlData,
  type XmlInvoiceFormat,
} from "$lib/pdf/invoice-xml";
import { readEInvoice } from "./index";
import {
  hasErrors,
  validateInvoiceXmlData,
  type EInvoiceIssue,
} from "./validate";

/** Thrown when the pre-flight check finds problems the user has to fix first. */
export class EInvoiceValidationError extends Error {
  constructor(readonly issues: EInvoiceIssue[]) {
    super(
      `E-invoice validation failed: ${issues
        .filter((i) => i.severity === "error")
        .map((i) => `${i.field} (${i.rule})`)
        .join(", ")}`,
    );
  }
}

export interface EInvoiceFile {
  bytes: Uint8Array;
  /** File extension without the dot: hybrid ZUGFeRD is a PDF, XRechnung is plain XML. */
  extension: "pdf" | "xml";
  /** Non-blocking findings (e.g. 0 % lines exported as tax-exempt). */
  warnings: EInvoiceIssue[];
}

/**
 * Check → generate → read back. The final step feeds the produced file through
 * the same reader used for incoming invoices and compares number and total, so
 * a regression in embedding or XML writing fails here instead of at the buyer.
 */
export async function createEInvoice(
  pdfData: InvoicePdfData,
  xmlData: InvoiceXmlData,
  format: XmlInvoiceFormat,
): Promise<EInvoiceFile> {
  const issues = validateInvoiceXmlData(xmlData, format);
  if (hasErrors(issues)) throw new EInvoiceValidationError(issues);

  const hybrid = format === "zugferd";
  const bytes = hybrid
    ? await createInvoicePdfA3({ pdfData, xmlData, format })
    : new TextEncoder().encode(renderInvoiceXml(xmlData, format));

  const back = await readEInvoice(bytes);
  if (
    !back ||
    back.number !== xmlData.invoiceNumber ||
    back.totals.grossCents !== xmlData.totals.grossCents
  ) {
    throw new Error(
      "Generated e-invoice failed the read-back check (number or total differs).",
    );
  }
  return { bytes, extension: hybrid ? "pdf" : "xml", warnings: issues };
}
