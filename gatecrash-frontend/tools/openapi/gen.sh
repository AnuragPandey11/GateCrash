#!/usr/bin/env bash
#
# Regenerate the committed OpenAPI spec and its TypeScript types — FRONTEND.md §4.2.
#
# Run against a locally running backend and commit the diff. CI runs this against `main` and
# fails if the committed spec drifts, which is the only thing standing between a backend rename
# and a runtime `undefined` in a guard's face.
#
#   ./tools/openapi/gen.sh                      # against http://localhost:8080
#   GATECRASH_API_URL=https://api.example ./tools/openapi/gen.sh
#
set -euo pipefail

API_URL="${GATECRASH_API_URL:-${VITE_API_URL:-http://localhost:8080}}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SPEC="$ROOT/packages/api/openapi.json"
OUT="$ROOT/packages/api/src/generated/schema.d.ts"

echo "Fetching OpenAPI spec from $API_URL/v3/api-docs"

if ! curl -sSf "$API_URL/v3/api-docs" -o "$SPEC.tmp"; then
  echo "error: could not reach $API_URL/v3/api-docs" >&2
  echo "       start the backend first:" >&2
  echo "       cd gatecrash-backend && mvn spring-boot:run -Dspring-boot.run.profiles=local" >&2
  rm -f "$SPEC.tmp"
  exit 1
fi

# Pretty-print so the committed spec produces a reviewable diff rather than one enormous line.
node -e "
  const fs = require('fs');
  const spec = JSON.parse(fs.readFileSync('$SPEC.tmp', 'utf8'));
  fs.writeFileSync('$SPEC', JSON.stringify(spec, null, 2) + '\n');
"
rm -f "$SPEC.tmp"

mkdir -p "$(dirname "$OUT")"
pnpm --filter @gatecrash/api exec openapi-typescript "$SPEC" -o "$OUT"

echo
echo "Wrote:"
echo "  $SPEC"
echo "  $OUT"
echo
echo "Both are committed. If this produced a diff, a backend contract changed — check that the"
echo "hand-written Zod schemas in packages/api/src/schemas/ still match (FRONTEND.md §4.2)."
