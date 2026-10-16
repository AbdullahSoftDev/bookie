import { describe, expect, test } from "bun:test";

import { epcMatrix, epcPayload } from "../../../src/lib/pdf/epc-qr";
import type { InvoicePdfData } from "../../../src/lib/pdf/invoice-pdf";

const base = {
  issuerName: "Example GmbH",
  issuerBankAccountHolder: "Max Mustermann",
  issuerBankIban: "DE89 3704 0044 0532 0130 00",
  issuerBankBic: "cobadeffxxx",
  currency: "EUR",
  totalCents: 11905,
} as InvoicePdfData;

describe("EPC QR", () => {
  test("payload follows EPC069-12 v002", () => {
    expect(epcPayload(base, "Rechnung RE-1")).toBe(
      "BCD\n002\n1\nSCT\nCOBADEFFXXX\nMax Mustermann\nDE89370400440532013000\nEUR119.05\n\n\nRechnung RE-1",
    );
  });

  test("no payload without IBAN, for non-EUR or zero total", () => {
    expect(epcPayload({ ...base, issuerBankIban: "" }, "x")).toBeNull();
    expect(epcPayload({ ...base, currency: "CHF" }, "x")).toBeNull();
    expect(epcPayload({ ...base, totalCents: 0 }, "x")).toBeNull();
  });

  test("falls back to issuer name and truncates long fields", () => {
    const p = epcPayload(
      { ...base, issuerBankAccountHolder: "" },
      "r".repeat(200),
    )!.split("\n");
    expect(p[5]).toBe("Example GmbH");
    expect(p[10]).toHaveLength(140);
  });

  test("matrix is square", () => {
    const m = epcMatrix(epcPayload(base, "Rechnung RE-1")!);
    expect(m.length).toBeGreaterThan(20);
    expect(m.every((row) => row.length === m.length)).toBe(true);
  });
});
