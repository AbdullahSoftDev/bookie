# E-Rechnung: Ist-Stand (Audit)

Stand: 2026-10-14. Ehrliche Bestandsaufnahme, keine Werbeaussage. Die Abschnitte 1 und 3 stammen aus dem ersten
Audit (ohne Java); Abschnitt 2 und 4 sind aktualisiert und mit Mustangproject/veraPDF geprüft.

## 1. Was existiert

| Bereich | Datei | Befund |
|---|---|---|
| CII-XML-Erzeugung | `src/lib/pdf/invoice-xml.ts` (`renderInvoiceXml`, ab Z. 185) | Handgeschriebener Emitter, ZUGFeRD/Factur-X **BASIC** (`urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic`, Z. 119-123) und XRechnung 3.0 CII (`...#urn:xeinkauf.de:kosit:xrechnung_3.0`). Nur CII, kein UBL. |
| PDF/A-3-Hülle | `src/lib/pdf/invoice-pdf-a3.ts` (`createInvoicePdfA3`, Z. 103) | pdf-lib, bettet XML als `factur-x.xml` / `xrechnung.xml` ein (Z. 61-64, 135), `AFRelationship.Alternative`, XMP mit `pdfaid` 3B und `fx:`-Block, sRGB-OutputIntent ohne ICC. |
| Einstellung | `src-tauri/migrations/0024/01_einvoice_format.sql`, `src-tauri/src/lib.rs:1171` | `einvoice_format` (plain/zugferd/xrechnung) in Organisationseinstellungen; UI `src/routes/einstellungen/organisation/+page.svelte`. |
| Tests | `tests/lib/pdf/invoice-xml.test.ts`, `invoice-pdf-a3.test.ts`, `einvoice-validator.test.ts` | Struktur- und Feldtests; Mustang-Validierung nur mit `BOOKIE_TEST_MUSTANG=1` + Java (Z. 3 der Datei), hier übersprungen. |
| Empfang (neu) | `src/lib/einvoice/` (`parse.ts`, `xml.ts`, `pdf.ts`, `types.ts`, `index.ts`), `src/common/EInvoicePreview.svelte` | UBL-Invoice/CreditNote und CII lesen, XML aus ZUGFeRD/Factur-X-PDF ziehen. Siehe Abschnitt 3. |
| GoBD | `src-tauri/src/gobd.rs` | GoBD-Export (ZIP/CSV, Audit-Log). Enthält **keine** E-Rechnungs-Logik (kein Treffer für XRechnung/ZUGFeRD/CII/UBL). |
| Eingehende Rechnungen | `src/routes/eingehende-rechnungen/+page.svelte` | Vorher: nur manuelle Erfassung + Dateianhang (PDF/Bild), kein XML-Import. Jetzt: Erkennung und Vorschau (Z. ~33-34, 430-437), Original wird unverändert gespeichert (`writeLocalAttachment` / `uploadFile` nutzen `file.arrayBuffer()`). |

## 2. Ausgang ist angebunden

Stand 2026-10-14: `InvoiceForm.svelte` ruft bei `einvoice_format = zugferd | xrechnung` `createEInvoice`
(`src/lib/einvoice/export.ts`) statt `createInvoicePdf`. Ablauf: Daten aufbauen (`build.ts`) → Vorprüfung
(`validate.ts`, blockiert bei Fehlern) → XML (`invoice-xml.ts`) → bei ZUGFeRD PDF/A-3-Hülle (`invoice-pdf-a3.ts`,
eingebettete Liberation Sans, sRGB-ICC, XMP-Erweiterungsschema, Trailer-ID) → Rückleseprobe mit dem Empfangscode.
Die S3-Ablage nutzt bei ZUGFeRD das Hybrid-PDF, bei XRechnung weiterhin das optische PDF.

**Geprüft mit Mustangproject 2.16.3** (XSD, EN-16931- und XRechnung-Schematron, veraPDF PDF/A-3B): ZUGFeRD
(Standardfall, Mischfall 19 %/0 % mit Steuernummer statt USt-IdNr.) und XRechnung ohne Befund
(`BOOKIE_TEST_MUSTANG=1`, siehe `scripts/fetch-mustang.sh`). Der KoSIT-Validator selbst wurde nicht separat ausgeführt.

## 3. Empfang (5.2) - Entscheidung

- Eigener, winziger Namespace-ignorierender XML-Leser (`xml.ts`) statt `DOMParser`, weil `DOMParser`
  unter `bun test` fehlt und keine neue Abhängigkeit hinzukommen soll. Elemente werden per
  Local-Name-Pfad gelesen. Grenzen: keine Schema-/Namespace-URI-Prüfung, keine Validierung,
  DOCTYPE mit ENTITY wird abgelehnt.
- PDF: `pdf-lib` (bereits Abhängigkeit) liest `/Names/EmbeddedFiles` bzw. `/AF`; bevorzugt `factur-x.xml`,
  `zugferd-invoice.xml`, `xrechnung.xml`.
- Gelesen werden: Nummer, Datum, Fälligkeit, Währung, Typcode, Leitweg/Käuferreferenz, Verkäufer/Käufer
  (Name, Adresse, USt-Id, Steuernummer, E-Mail), Positionen, Steueraufschlüsselung, Summen.
  Nicht gelesen: Zahlungsangaben (IBAN), Zu-/Abschläge auf Dokumentebene, Anhänge (BG-24), Skonto.
- Die Anzeige ist eine Lesehilfe, keine Prüfung der Rechnung. Prüfung gegen EN 16931/XRechnung findet nicht statt.

## 4. Ausgang: bekannte Lücken

Behoben seit dem ersten Audit: ZUGFeRD jetzt im Profil EN 16931 (statt BASIC), Steuerkategorie (S/E) mit
Befreiungsgrund, UN/ECE-Einheiten, Verkäuferkontakt (BG-6), elektronische Adressen (BT-34/BT-49), Zahlungsreferenz
(BT-83), Leistungszeitraum (BG-14), Käuferreferenz (BT-10, Formularfeld und Spalte `invoices.buyer_reference`, Migration 0032), Verkäufer-ID bei
reiner Steuernummer (BR-CO-26), PDF/A-3 (Schriften, ICC, XMP, Trailer-ID), Business Process für XRechnung (BT-23).

Offen:

1. Steuerkategorien AE (Reverse Charge), K (innergemeinschaftlich), G (Ausfuhr), O: der Emitter kennt sie
   (`category`, `exemptionReason`), das Formular liefert sie nicht; 0 % wird immer als E gesendet (Warnung).
2. Keine Anzahlungen, keine Dokumentebenen-Rabatte, keine Gutschrift (nur Typ 380).
3. Kein UBL-Export (nur CII).
4. Vorprüfung ist eine Teilmenge der EN-16931-Regeln; verbindlich sind KoSIT bzw. Mustangproject (nur manuell/gated).
5. XRechnung als reine XML-Datei: kein PDF-Begleitdokument, S3 hält das optische PDF.

## 5. Quellen

- EN 16931-1:2017 (Semantisches Datenmodell), CEN/TS 16931-3-x (Syntax-Bindings UBL/CII)
- XRechnung-Standard (CIUS) und Prüfregeln BR-DE-*, KoSIT / XÖV-Koordinierungsstelle: xrechnung.org, validator: github.com/itplr-kosit/validator
- Factur-X 1.0 / ZUGFeRD 2.x Spezifikation (FNFE-MPE / FeRD)
- Gesetzliche Fristen und Pflichten (Wachstumschancengesetz, BMF-Schreiben): **von Mensch gegen BMF/KoSIT zu prüfen**, hier nicht behauptet.
