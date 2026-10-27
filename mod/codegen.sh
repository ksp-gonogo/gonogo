#!/usr/bin/env bash
# Regenerates every committed generated artifact: the whole of
# scripts/run-codegen.mjs, whatever command an author remembers. The contract
# step alone is mod/codegen-contract.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${1:-}" = "--self-test" ]; then
  exec bash "$ROOT/mod/codegen-contract.sh" --self-test
fi
exec node "$ROOT/scripts/run-codegen.mjs" "$@"
