/**
 * COMP-3.b: Cross-Industry Invoice (CII) XML emitter.
 *
 * Produces a UN/CEFACT CII XML document for one of two e-invoice flavours
 * Bookie supports today (selected via `settings_organization.einvoice_format`,
 * see COMP-3.a):
 *
 *   - 'zugferd'   — ZUGFeRD 2.x **EN 16931** profile (Factur-X 1.0 "COMFORT")
 *   - 'xrechnung' — XRechnung 3.0 CIUS over CII
 *
 * Both flavours share the same CII schema; only the
 * `GuidelineSpecifiedDocumentContextParameter/ID` differs. This emitter writes
 * the structured XML *only* — the PDF/A-3 wrapping that turns ZUGFeRD into a
 * hybrid invoice lands in COMP-3.c, and Mustangproject round-trip validation
 * lands in COMP-3.d.
 *
 * Field layout follows the Mustangproject schema (`org.mustangproject.ZUGFeRD`)
 * so the resulting XML can be consumed by their validator. Money fields on
 * `InvoiceXmlData` are integer cents (minor currency units) — matching the
 * storage format introduced by migration 0015 (DAT-1.a) — and are converted
 * to two-decimal `Amount` strings at the XML boundary.
 */

/**
 * Subset of `EInvoiceFormat` (COMP-3.a, `settings_organization.einvoice_format`)
 * for which the XML emitter is defined. The third value of `EInvoiceFormat`,
 * `'plain'`, deliberately has no XML representation — the emitter is only
 * called when the user has opted into a structured e-invoice format.
 *
 * Defined locally rather than imported from `$lib/db/types` so this module
 * builds independently of COMP-3.a's settings type, which keeps the emitter
 * usable from places (e.g. background jobs) that don't pull in the settings
 * surface.
 */
export type XmlInvoiceFormat = "zugferd" | "xrechnung";

/** UNTDID 5305 VAT category codes Bookie can emit. */
export type TaxCategory = "S" | "Z" | "E" | "AE" | "K" | "G" | "O";

/** BT-120 default for 0 % lines. ponytail: reverse charge / intra-EU supply (AE/K) need explicit data. */
export const DEFAULT_EXEMPTION_REASON = "Umsatzsteuerfrei";

/** Category for a rate when the caller does not set one. */
export function taxCategoryFor(rate: number): TaxCategory {
  return rate > 0 ? "S" : "E";
}

const UNIT_CODES: Record<string, string> = {
  stk: "C62",
  stück: "C62",
  st: "C62",
  pcs: "C62",
  piece: "C62",
  pauschal: "C62",
  h: "HUR",
  std: "HUR",
  stunde: "HUR",
  stunden: "HUR",
  hour: "HUR",
  hours: "HUR",
  tag: "DAY",
  tage: "DAY",
  day: "DAY",
  days: "DAY",
  monat: "MON",
  monate: "MON",
  month: "MON",
  km: "KMT",
  kg: "KGM",
  m: "MTR",
  l: "LTR",
};

/**
 * Map a free-text unit to a UN/ECE Rec. 20 code (BT-130 requires one).
 * Already-valid codes pass through; unknown text falls back to C62 ("one").
 */
export function toUnitCode(unit: string | null | undefined): string {
  const u = (unit ?? "").trim();
  if (!u) return "C62";
  if (/^[A-Z0-9]{2,3}$/.test(u)) return u;
  return UNIT_CODES[u.toLowerCase()] ?? "C62";
}

/**
 * Input to `renderInvoiceXml`.
 *
 * Deliberately decoupled from `InvoicePdfData` so callers can populate it
 * directly from the DB (`Invoice` + `InvoiceItem` rows + `OrganizationSettings`)
 * without going through the PDF render path.
 */
export interface InvoiceXmlData {
  /** Invoice number printed on the document, mapped to ExchangedDocument/ID. */
  invoiceNumber: string;
  /** ISO-8601 issue date (YYYY-MM-DD). Mapped to IssueDateTime (format 102). */
  issueDate: string;
  /** Optional ISO-8601 delivery date (YYYY-MM-DD). Defaults to issueDate. */
  deliveryDate?: string;
  /** Optional ISO-8601 due date (YYYY-MM-DD). */
  dueDate?: string;
  /** ISO 4217 currency code (e.g. 'EUR'). */
  currency: string;
  /**
   * Optional buyer reference (BT-10). XRechnung requires it (BR-DE-15), e.g.
   * the Leitweg-ID for public-sector buyers. Emitted first inside
   * ApplicableHeaderTradeAgreement, as the CII schema sequence demands.
   */
  buyerReference?: string;
  /** Optional invoice notes — emitted as `IncludedNote/Content`. */
  notes?: string;

  /** Seller / issuer (the Bookie operator). */
  seller: {
    name: string;
    street: string;
    postalCode: string;
    city: string;
    countryCode: string;
    vatId?: string;
    taxNumber?: string;
    bankIban?: string;
    bankBic?: string;
    bankAccountHolder?: string;
    /** Seller contact (BG-6). Mandatory for XRechnung (BR-DE-2/5/6/7). */
    email?: string;
    phone?: string;
  };

  /** Buyer / recipient. */
  buyer: {
    name: string;
    street: string;
    postalCode: string;
    city: string;
    countryCode: string;
    vatId?: string;
    /** Buyer electronic address (BT-49). Mandatory for XRechnung. */
    email?: string;
  };

  /** Optional billing / service period (BG-14), ISO dates. */
  servicePeriodStart?: string;
  servicePeriodEnd?: string;

  /** Line items. Position is 1-based and emitted as LineID. */
  items: Array<{
    position: number;
    description: string;
    quantity: number;
    /** Free text ("Stk", "h") or a UN/ECE Rec. 20 code ("C62", "HUR"); see `toUnitCode`. */
    unit: string;
    unitPriceNetCents: number;
    lineTotalNetCents: number;
    taxRate: number;
  }>;

  /** Tax breakdown by rate. One ApplicableTradeTax block per group. */
  taxGroups: Array<{
    rate: number;
    netAmountCents: number;
    amountCents: number;
    /** Overrides the derived category (rate > 0 → S, else E). */
    category?: TaxCategory;
    /** BT-120. Required for every category except S; defaults to `DEFAULT_EXEMPTION_REASON` for E. */
    exemptionReason?: string;
  }>;

  /** Document-level totals. All in minor currency units (cents). */
  totals: {
    netCents: number;
    taxCents: number;
    grossCents: number;
  };
}

// ---------------------------------------------------------------------------
// Format-specific guideline IDs
// ---------------------------------------------------------------------------

/**
 * GuidelineSpecifiedDocumentContextParameter/ID per format.
 *
 * - ZUGFeRD 2.x EN 16931 (Factur-X 1.0 "COMFORT") — the plain EN 16931
 *   guideline URN, see the Factur-X spec.
 * - XRechnung 3.0 CIUS over CII — see KoSIT's published guideline URN.
 */
/** BT-23, required by the XRechnung CII schematron (PEPPOL-EN16931-R001). */
const PEPPOL_BILLING_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

const GUIDELINE_ID: Record<XmlInvoiceFormat, string> = {
  zugferd: "urn:cen.eu:en16931:2017",
  xrechnung:
    "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Escape the five XML metacharacters. Sufficient for element bodies and
 * double-quoted attributes — which is all the emitter writes.
 */
export function escapeXml(s: string | null | undefined): string {
  if (s === null || s === undefined) return "";
  return (
    String(s)
      // XML 1.0 forbids most control characters, even escaped.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  );
}

/**
 * Format an integer cent amount as a fixed two-decimal string, e.g.
 * `1999` → `"19.99"`. CII Amount nodes are decimal with a period separator
 * regardless of locale; rounding is half-away-from-zero to match SQLite/JS
 * `Math.round` semantics on positive values and to keep the line-by-line
 * sums consistent with the stored cents.
 */
export function formatCentsAsAmount(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  const whole = Math.trunc(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

/**
 * Convert an ISO-8601 calendar date (YYYY-MM-DD) into the CII basic format
 * 102 (YYYYMMDD). Input is trusted (it comes from the DB `DATE` column or a
 * date input), so we only strip dashes; malformed input returns ''.
 */
export function isoDateToCiiBasic(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}${m[2]}${m[3]}` : "";
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const NL = "\n";

function dateTime(tag: string, iso: string, indent: string): string {
  return `${NL}${indent}<ram:${tag}><udt:DateTimeString format="102">${isoDateToCiiBasic(iso)}</udt:DateTimeString></ram:${tag}>`;
}

/**
 * Render a CII XML document for the given invoice and target e-invoice
 * format. The output is a complete, namespaced `<rsm:CrossIndustryInvoice>`
 * document beginning with `<?xml version="1.0" encoding="UTF-8"?>`.
 *
 * Optional fields that are empty never produce empty placeholder elements.
 * Run `validateInvoiceXmlData` (src/lib/einvoice/validate.ts) first: this
 * emitter writes what it is given.
 */
export function renderInvoiceXml(
  data: InvoiceXmlData,
  format: XmlInvoiceFormat,
): string {
  const guideline = GUIDELINE_ID[format];
  const processXml =
    format === "xrechnung"
      ? `${NL}\t\t<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${PEPPOL_BILLING_PROCESS}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>`
      : "";
  const currency = escapeXml(data.currency);
  const deliveryDate = data.deliveryDate || data.issueDate;

  const itemsXml = data.items.map((item) => renderLineItem(item)).join("");
  const taxXml = data.taxGroups.map((g) => renderTradeTax(g)).join("");
  const noteXml = data.notes
    ? `${NL}\t\t<ram:IncludedNote><ram:Content>${escapeXml(data.notes)}</ram:Content></ram:IncludedNote>`
    : "";

  const reg = (scheme: string, v: string) =>
    `${NL}\t\t\t\t<ram:SpecifiedTaxRegistration><ram:ID schemeID="${scheme}">${escapeXml(v)}</ram:ID></ram:SpecifiedTaxRegistration>`;
  const email = (v?: string) =>
    v
      ? `${NL}\t\t\t\t<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${escapeXml(v)}</ram:URIID></ram:URIUniversalCommunication>`
      : "";
  const address = (p: InvoiceXmlData["seller"] | InvoiceXmlData["buyer"]) =>
    `${NL}\t\t\t\t<ram:PostalTradeAddress>
\t\t\t\t\t<ram:PostcodeCode>${escapeXml(p.postalCode)}</ram:PostcodeCode>
\t\t\t\t\t<ram:LineOne>${escapeXml(p.street)}</ram:LineOne>
\t\t\t\t\t<ram:CityName>${escapeXml(p.city)}</ram:CityName>
\t\t\t\t\t<ram:CountryID>${escapeXml(p.countryCode)}</ram:CountryID>
\t\t\t\t</ram:PostalTradeAddress>`;

  // BT-29: BR-CO-26 wants a seller identifier, legal id or VAT id. A seller
  // with only a Steuernummer identifies by that.
  const sellerId =
    !data.seller.vatId && data.seller.taxNumber
      ? `${NL}\t\t\t\t<ram:ID>${escapeXml(data.seller.taxNumber)}</ram:ID>`
      : "";
  const sellerContact =
    data.seller.phone || data.seller.email
      ? `${NL}\t\t\t\t<ram:DefinedTradeContact>
\t\t\t\t\t<ram:PersonName>${escapeXml(data.seller.name)}</ram:PersonName>${
          data.seller.phone
            ? `${NL}\t\t\t\t\t<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${escapeXml(data.seller.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>`
            : ""
        }${
          data.seller.email
            ? `${NL}\t\t\t\t\t<ram:EmailURIUniversalCommunication><ram:URIID>${escapeXml(data.seller.email)}</ram:URIID></ram:EmailURIUniversalCommunication>`
            : ""
        }
\t\t\t\t</ram:DefinedTradeContact>`
      : "";

  const paymentMeansXml = data.seller.bankIban
    ? renderPaymentMeans(
        data.seller.bankIban,
        data.seller.bankBic,
        data.seller.bankAccountHolder,
      )
    : "";

  const buyerRefXml = data.buyerReference
    ? `${NL}\t\t\t<ram:BuyerReference>${escapeXml(data.buyerReference)}</ram:BuyerReference>`
    : "";

  const periodXml =
    data.servicePeriodStart && data.servicePeriodEnd
      ? `${NL}\t\t\t<ram:BillingSpecifiedPeriod>${dateTime("StartDateTime", data.servicePeriodStart, "\t\t\t\t")}${dateTime("EndDateTime", data.servicePeriodEnd, "\t\t\t\t")}${NL}\t\t\t</ram:BillingSpecifiedPeriod>`
      : "";

  const dueDateXml = data.dueDate
    ? `${NL}\t\t\t<ram:SpecifiedTradePaymentTerms>${dateTime("DueDateDateTime", data.dueDate, "\t\t\t\t")}${NL}\t\t\t</ram:SpecifiedTradePaymentTerms>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
\t<rsm:ExchangedDocumentContext>${processXml}
\t\t<ram:GuidelineSpecifiedDocumentContextParameter>
\t\t\t<ram:ID>${escapeXml(guideline)}</ram:ID>
\t\t</ram:GuidelineSpecifiedDocumentContextParameter>
\t</rsm:ExchangedDocumentContext>
\t<rsm:ExchangedDocument>
\t\t<ram:ID>${escapeXml(data.invoiceNumber)}</ram:ID>
\t\t<ram:TypeCode>380</ram:TypeCode>
\t\t<ram:IssueDateTime>
\t\t\t<udt:DateTimeString format="102">${isoDateToCiiBasic(data.issueDate)}</udt:DateTimeString>
\t\t</ram:IssueDateTime>${noteXml}
\t</rsm:ExchangedDocument>
\t<rsm:SupplyChainTradeTransaction>${itemsXml}
\t\t<ram:ApplicableHeaderTradeAgreement>${buyerRefXml}
\t\t\t<ram:SellerTradeParty>${sellerId}
\t\t\t\t<ram:Name>${escapeXml(data.seller.name)}</ram:Name>${sellerContact}${address(data.seller)}${email(data.seller.email)}${data.seller.vatId ? reg("VA", data.seller.vatId) : ""}${data.seller.taxNumber ? reg("FC", data.seller.taxNumber) : ""}
\t\t\t</ram:SellerTradeParty>
\t\t\t<ram:BuyerTradeParty>
\t\t\t\t<ram:Name>${escapeXml(data.buyer.name)}</ram:Name>${address(data.buyer)}${email(data.buyer.email)}${data.buyer.vatId ? reg("VA", data.buyer.vatId) : ""}
\t\t\t</ram:BuyerTradeParty>
\t\t</ram:ApplicableHeaderTradeAgreement>
\t\t<ram:ApplicableHeaderTradeDelivery>
\t\t\t<ram:ActualDeliverySupplyChainEvent>
\t\t\t\t<ram:OccurrenceDateTime>
\t\t\t\t\t<udt:DateTimeString format="102">${isoDateToCiiBasic(deliveryDate)}</udt:DateTimeString>
\t\t\t\t</ram:OccurrenceDateTime>
\t\t\t</ram:ActualDeliverySupplyChainEvent>
\t\t</ram:ApplicableHeaderTradeDelivery>
\t\t<ram:ApplicableHeaderTradeSettlement>
\t\t\t<ram:PaymentReference>${escapeXml(data.invoiceNumber)}</ram:PaymentReference>
\t\t\t<ram:InvoiceCurrencyCode>${currency}</ram:InvoiceCurrencyCode>${paymentMeansXml}${taxXml}${periodXml}${dueDateXml}
\t\t\t<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
\t\t\t\t<ram:LineTotalAmount>${formatCentsAsAmount(data.totals.netCents)}</ram:LineTotalAmount>
\t\t\t\t<ram:TaxBasisTotalAmount>${formatCentsAsAmount(data.totals.netCents)}</ram:TaxBasisTotalAmount>
\t\t\t\t<ram:TaxTotalAmount currencyID="${currency}">${formatCentsAsAmount(data.totals.taxCents)}</ram:TaxTotalAmount>
\t\t\t\t<ram:GrandTotalAmount>${formatCentsAsAmount(data.totals.grossCents)}</ram:GrandTotalAmount>
\t\t\t\t<ram:DuePayableAmount>${formatCentsAsAmount(data.totals.grossCents)}</ram:DuePayableAmount>
\t\t\t</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
\t\t</ram:ApplicableHeaderTradeSettlement>
\t</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

/**
 * Render one `IncludedSupplyChainTradeLineItem`. The line carries its own tax
 * category so validators can reconcile it against the document-level block.
 */
function renderLineItem(item: InvoiceXmlData["items"][number]): string {
  const cat = taxCategoryFor(item.taxRate);
  return `
\t\t<ram:IncludedSupplyChainTradeLineItem>
\t\t\t<ram:AssociatedDocumentLineDocument>
\t\t\t\t<ram:LineID>${escapeXml(String(item.position))}</ram:LineID>
\t\t\t</ram:AssociatedDocumentLineDocument>
\t\t\t<ram:SpecifiedTradeProduct>
\t\t\t\t<ram:Name>${escapeXml(item.description)}</ram:Name>
\t\t\t</ram:SpecifiedTradeProduct>
\t\t\t<ram:SpecifiedLineTradeAgreement>
\t\t\t\t<ram:NetPriceProductTradePrice>
\t\t\t\t\t<ram:ChargeAmount>${formatCentsAsAmount(item.unitPriceNetCents)}</ram:ChargeAmount>
\t\t\t\t</ram:NetPriceProductTradePrice>
\t\t\t</ram:SpecifiedLineTradeAgreement>
\t\t\t<ram:SpecifiedLineTradeDelivery>
\t\t\t\t<ram:BilledQuantity unitCode="${escapeXml(toUnitCode(item.unit))}">${item.quantity}</ram:BilledQuantity>
\t\t\t</ram:SpecifiedLineTradeDelivery>
\t\t\t<ram:SpecifiedLineTradeSettlement>
\t\t\t\t<ram:ApplicableTradeTax>
\t\t\t\t\t<ram:TypeCode>VAT</ram:TypeCode>
\t\t\t\t\t<ram:CategoryCode>${cat}</ram:CategoryCode>
\t\t\t\t\t<ram:RateApplicablePercent>${item.taxRate.toFixed(2)}</ram:RateApplicablePercent>
\t\t\t\t</ram:ApplicableTradeTax>
\t\t\t\t<ram:SpecifiedTradeSettlementLineMonetarySummation>
\t\t\t\t\t<ram:LineTotalAmount>${formatCentsAsAmount(item.lineTotalNetCents)}</ram:LineTotalAmount>
\t\t\t\t</ram:SpecifiedTradeSettlementLineMonetarySummation>
\t\t\t</ram:SpecifiedLineTradeSettlement>
\t\t</ram:IncludedSupplyChainTradeLineItem>`;
}

/**
 * Render one document-level `ApplicableTradeTax` block (one per VAT group).
 */
function renderTradeTax(group: InvoiceXmlData["taxGroups"][number]): string {
  const cat = group.category ?? taxCategoryFor(group.rate);
  const reason =
    cat === "S"
      ? ""
      : `${NL}\t\t\t\t<ram:ExemptionReason>${escapeXml(group.exemptionReason || DEFAULT_EXEMPTION_REASON)}</ram:ExemptionReason>`;
  return `
\t\t\t<ram:ApplicableTradeTax>
\t\t\t\t<ram:CalculatedAmount>${formatCentsAsAmount(group.amountCents)}</ram:CalculatedAmount>
\t\t\t\t<ram:TypeCode>VAT</ram:TypeCode>${reason}
\t\t\t\t<ram:BasisAmount>${formatCentsAsAmount(group.netAmountCents)}</ram:BasisAmount>
\t\t\t\t<ram:CategoryCode>${cat}</ram:CategoryCode>
\t\t\t\t<ram:RateApplicablePercent>${group.rate.toFixed(2)}</ram:RateApplicablePercent>
\t\t\t</ram:ApplicableTradeTax>`;
}

/**
 * Render `SpecifiedTradeSettlementPaymentMeans` for SEPA credit transfer.
 * UNTDID 4461 code 58 = "SEPA credit transfer" (BR-DE-1 compatible).
 */
function renderPaymentMeans(
  iban: string,
  bic: string | undefined,
  holder: string | undefined,
): string {
  const holderName = holder
    ? `${NL}\t\t\t\t\t<ram:AccountName>${escapeXml(holder)}</ram:AccountName>`
    : "";
  const bicXml = bic
    ? `${NL}\t\t\t\t<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${escapeXml(bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>`
    : "";
  return `
\t\t\t<ram:SpecifiedTradeSettlementPaymentMeans>
\t\t\t\t<ram:TypeCode>58</ram:TypeCode>
\t\t\t\t<ram:PayeePartyCreditorFinancialAccount>
\t\t\t\t\t<ram:IBANID>${escapeXml(iban)}</ram:IBANID>${holderName}
\t\t\t\t</ram:PayeePartyCreditorFinancialAccount>${bicXml}
\t\t\t</ram:SpecifiedTradeSettlementPaymentMeans>`;
}
