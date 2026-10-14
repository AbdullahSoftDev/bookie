# E-Rechnung in Bookie (Anwenderhandbuch)

> Hinweis: Bookie ersetzt keine Rechts- oder Steuerberatung. Alle Fristen und Pflichten
> (wer ab wann empfangen/senden muss) sind **von Mensch gegen BMF/KoSIT zu prüfen**,
> bevor Sie sich darauf verlassen. Dieses Dokument nennt bewusst keine Stichtage.

## Was Bookie kann

**Eingehende E-Rechnungen lesen (verfügbar).** Unter *Eingehende Rechnungen* können Sie hochladen:

- eine XRechnung als XML (Syntax UBL oder CII),
- ein ZUGFeRD-/Factur-X-PDF (PDF mit eingebettetem XML).

Bookie erkennt das Format, zeigt Lieferant, Rechnungsnummer, Datum, Positionen und Summen an und kann
auf Knopfdruck *Daten übernehmen*, um das Erfassungsformular vorzubefüllen. Bitte Werte prüfen,
bevor Sie speichern.

**Archivierung.** Die hochgeladene Originaldatei wird byte-genau und unverändert gespeichert (lokal oder S3).
Bookie liest die Datei nur, sie wird nie umgeschrieben. Bei einem ZUGFeRD-PDF bleibt das XML darin enthalten.
Ob und wie lange Sie das Original aufbewahren müssen, klären Sie bitte mit Ihrer Steuerberatung (GoBD).

**Ausgehende E-Rechnungen.** Unter *Einstellungen → Organisation → E-Rechnungs-Format* wählen Sie:

- *ZUGFeRD*: „PDF speichern“ erzeugt ein Hybrid-PDF (PDF/A-3) mit eingebettetem `factur-x.xml` im Profil EN 16931.
  Menschen lesen das PDF, Software liest das XML.
- *XRechnung*: „PDF speichern“ speichert eine reine XML-Datei (XRechnung 3.0, CII). Dafür sind zusätzlich
  Leitweg-ID/Käuferreferenz (Feld im Rechnungsformular, pro Rechnung), E-Mail und Telefon des Unternehmens sowie die
  E-Mail des Kunden Pflicht. Die Käuferreferenz ist nach dem Ausstellen der Rechnung nicht mehr änderbar.

Vor dem Speichern prüft Bookie die Rechnung (Pflichtangaben, Summen, IBAN, USt-IdNr.) und nennt fehlende oder
fehlerhafte Angaben. Die fertige Datei wird zur Kontrolle zurückgelesen. Die Prüfung ist eine Teilmenge der
EN-16931-Regeln; der Mustangproject-Validator (siehe `scripts/fetch-mustang.sh`) bestätigt die Testrechnungen.
Verbindlich bleibt der offizielle KoSIT-Validator.

## Grenzen

- Eingehende Rechnungen werden nicht validiert. Bookie prüft nicht, ob sie EN 16931 oder der XRechnung-Prüfung
  entsprechen. Verbindlich ist der offizielle KoSIT-Validator.
- Ausgang: Steuersatz 0 % wird als *steuerbefreit* (Kategorie E, „Umsatzsteuerfrei“) übermittelt. Reverse Charge,
  innergemeinschaftliche Lieferungen, Kleinunternehmer-Hinweis, Anzahlungen, Rabatte auf Dokumentebene und
  Gutschriften werden nicht abgebildet. Einheiten werden aus Freitext zugeordnet (Stk → C62, Std → HUR, Tag → DAY, ...).
- Ausgang per Peppol oder Portal ist nicht enthalten; Bookie erzeugt nur die Datei.
- Gelesen werden die gängigen Felder; Zahlungsangaben (IBAN), Anhänge und Dokument-Rabatte werden nicht angezeigt.
- Gutschriften (UBL CreditNote, Typcode 381) werden gelesen, aber nicht gesondert verbucht.
- Beträge werden aus der Datei übernommen, nicht neu berechnet.

## Fehlerbehebung

- *"E-Rechnung konnte nicht gelesen werden"*: Die XML ist fehlerhaft oder keine UBL-/CII-Rechnung. Die Datei
  lässt sich trotzdem als normaler Anhang speichern.
- PDF ohne Erkennung: Es enthält vermutlich kein eingebettetes XML (normale PDF-Rechnung).

## Quellen

- EN 16931-1:2017 und Syntax-Bindings CEN/TS 16931-3 (UBL, CII)
- XRechnung-Standard (CIUS), KoSIT: https://xeinkauf.de/xrechnung/ , Validator: https://github.com/itplr-kosit/validator
- ZUGFeRD / Factur-X: https://www.ferd-net.de/ , https://fnfe-mpe.org/factur-x/
