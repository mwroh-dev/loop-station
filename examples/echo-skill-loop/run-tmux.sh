#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$PROJECT_ROOT/../.." && pwd)"
STATION_BIN="$REPO_ROOT/skills/loop-station/assets/harness-template/bin/station"

export STATION_CONFIG="$PROJECT_ROOT/station.json"
export STATION_RUNS_DIR="$PROJECT_ROOT/runs"
export STATION_AUTO_TRUST_PROJECTS="${STATION_AUTO_TRUST_PROJECTS:-1}"

node "$STATION_BIN" validate --json --skip-tools >/dev/null
node "$STATION_BIN" start --attach --limit "$@"
node "$STATION_BIN" run-next
