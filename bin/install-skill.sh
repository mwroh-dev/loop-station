#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

if [ "${1:-}" = "" ]; then
  echo "Usage: bin/install-skill.sh <project-dir> [--replace]" >&2
  exit 1
fi

PROJECT_DIR=$1
shift

exec node "$ROOT_DIR/bin/loop-station" install-skill --project "$PROJECT_DIR" "$@"
