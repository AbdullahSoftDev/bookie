#!/usr/bin/env bash
# Downloads the Mustangproject CLI (XSD + Schematron + veraPDF PDF/A check) used by
# tests/lib/pdf/einvoice-validator.test.ts, then prints how to run it. Needs Java 11+.
set -euo pipefail
VERSION=2.16.3
JAR="${MUSTANG_JAR:-$(git rev-parse --show-toplevel)/.cache/Mustang-CLI-$VERSION.jar}"
mkdir -p "$(dirname "$JAR")"
[ -s "$JAR" ] || curl -fsSL -o "$JAR" "https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/$VERSION/Mustang-CLI-$VERSION.jar"
echo "BOOKIE_TEST_MUSTANG=1 MUSTANG_JAR=$JAR bun test tests/lib/pdf/einvoice-validator.test.ts"
