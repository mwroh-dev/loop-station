#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$PROJECT_ROOT/../.." && pwd)"
STATION_BIN="$REPO_ROOT/skills/loop-station/assets/harness-template/bin/station"

export STATION_CONFIG="$PROJECT_ROOT/station.json"
export STATION_RUNS_DIR="$PROJECT_ROOT/runs"
export STATION_AUTO_TRUST_PROJECTS="${STATION_AUTO_TRUST_PROJECTS:-1}"

node "$STATION_BIN" cleanup >/dev/null 2>&1 || true
pkill -f "station orchestrate $PROJECT_ROOT/runs" >/dev/null 2>&1 || true
rm -rf "$PROJECT_ROOT/runs"
rm -rf "$PROJECT_ROOT/consumer/.loop-station-agent-workdirs" "$PROJECT_ROOT/provider/.loop-station-agent-workdirs" "$PROJECT_ROOT/.loop-station-agent-workdirs"

SESSION_PREFIX="$(node -e 'const c=require(process.argv[1]); process.stdout.write(String(c.sessionPrefix||"loop-station"));' "$PROJECT_ROOT/station.json")"
if command -v tmux >/dev/null 2>&1; then
  while read -r session; do
    if [[ -n "$session" && "$session" == "$SESSION_PREFIX"-* ]]; then
      tmux kill-session -t "$session" >/dev/null 2>&1 || true
    fi
  done < <(tmux list-sessions -F '#{session_name}' 2>/dev/null || true)
fi

echo "Reset complete: $PROJECT_ROOT"
