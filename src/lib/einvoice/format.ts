import { t } from "$lib/i18n";
import type { EInvoiceIssue } from "./validate";

/** One human-readable line per issue, e.g. "Position 2: Menge ungültig (BR-22)". */
export function describeIssue(i: EInvoiceIssue): string {
  const idx = /^(?:items|taxGroups)\[(\d+)\]/.exec(i.field);
  const pos =
    idx && i.field.startsWith("items")
      ? `${t("einvoice.position")} ${+idx[1] + 1}: `
      : "";
  const label = t(`einvoice.fields.${i.field.replace(/\[\d+\]/g, "")}`);
  return `${pos}${label} ${t(`einvoice.issue.${i.code}`)} (${i.rule})`;
}
