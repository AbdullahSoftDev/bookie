/** Form-side invoice line: string-typed inputs as held by InvoiceForm. */
export interface InvoiceTotalsLine {
  quantity: string;
  unit_price_net: string;
  tax_rate: string;
}

export interface InvoiceTaxGroup {
  rate: number;
  netAmount: number;
  amount: number;
}

export function lineTotal(item: InvoiceTotalsLine): number {
  return (
    (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price_net) || 0)
  );
}

/** Net subtotal, VAT per rate, VAT total and gross total (floats, in EUR). */
export function computeInvoiceTotals(items: InvoiceTotalsLine[]): {
  subtotal: number;
  taxGroups: InvoiceTaxGroup[];
  taxTotal: number;
  grossTotal: number;
} {
  const groups: Record<string, InvoiceTaxGroup> = {};
  let subtotal = 0;
  for (const item of items) {
    const rate = parseFloat(item.tax_rate) || 0;
    const total = lineTotal(item);
    subtotal += total;
    const g = (groups[String(rate)] ??= { rate, netAmount: 0, amount: 0 });
    g.netAmount += total;
    g.amount += (total * rate) / 100;
  }
  const taxGroups = Object.values(groups);
  const taxTotal = taxGroups.reduce((sum, g) => sum + g.amount, 0);
  return { subtotal, taxGroups, taxTotal, grossTotal: subtotal + taxTotal };
}

/**
 * Conversion at the PDF boundary: the form computes totals as floats, the PDF
 * generator (DAT-1.c) consumes integer cents only. The form-side write path
 * will move to cents in DAT-1.d (#54).
 */
export function toCents(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}
