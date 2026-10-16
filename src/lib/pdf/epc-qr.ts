/**
 * EPC QR code ("GiroCode", EPC069-12 v002): banking apps scan it and prefill
 * a SEPA credit transfer with recipient, IBAN, amount and reference.
 */

import { encode } from "uqr";
import type { InvoicePdfData } from "./invoice-pdf";

/** Payload string, or null when the invoice cannot be paid by SEPA transfer. */
export function epcPayload(
  data: InvoicePdfData,
  remittance: string,
): string | null {
  const iban = data.issuerBankIban.replace(/\s+/g, "").toUpperCase();
  const c = data.totalCents;
  if (!iban || data.currency !== "EUR" || c < 1 || c > 99_999_999_999)
    return null;
  return [
    "BCD",
    "002",
    "1", // UTF-8
    "SCT",
    data.issuerBankBic.replace(/\s+/g, "").toUpperCase(),
    (data.issuerBankAccountHolder || data.issuerName).slice(0, 70),
    iban,
    `EUR${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`,
    "", // purpose code
    "", // structured reference
    remittance.slice(0, 140),
  ].join("\n");
}

/** Module matrix (true = dark), quiet zone not included. EPC requires ECC level M. */
export function epcMatrix(payload: string): boolean[][] {
  return encode(payload, { ecc: "M", border: 0 }).data;
}

export function epcSvg(payload: string, sizeMm: number): string {
  const m = epcMatrix(payload);
  let d = "";
  m.forEach((row, y) =>
    row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${m.length + 8} ${m.length + 8}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges"><rect x="-4" y="-4" width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
