#!/usr/bin/env bash
set -euo pipefail

project_root="${NEONTRIP_ARRIVAL_LABELS_PROJECT:-/home/daniel/work/neontrip-ops}"

case "$project_root" in
  /home/daniel/*) ;;
  *)
    echo "Refusing project outside /home/daniel" >&2
    exit 1
    ;;
esac

for argument in "$@"; do
  case "$argument" in
    --mode|--mode=*|execute|--acknowledge-production-write|--persist)
      echo "This skill supports read-only dry runs only." >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$project_root/scripts/run_arrival_labels.ts" ]]; then
  echo "Arrival-label service not found in $project_root" >&2
  exit 1
fi

exec npm --prefix "$project_root" run arrival-labels:dry-run -- "$@"
