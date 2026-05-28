#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$PROJECT_ROOT/reset.sh"
"$PROJECT_ROOT/run-tmux.sh" "$@"
