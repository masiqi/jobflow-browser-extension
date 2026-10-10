#!/usr/bin/env bash
set -Eeuo pipefail

service_dir="${JOBFLOW_SERVICE_DIR:-$PWD}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/common.sh"
require_installed_remote_config
resolve_remote_cli
project_id="$JOBFLOW_PROJECT_ID"

cd -- "$service_dir"
start_log="$(mktemp "${TMPDIR:-/tmp}/jobflow-supabase-start.XXXXXX")"
cleanup() {
  local result=$?
  if (( result != 0 )); then
    # Failed oneshot ExecStart does not run ExecStop. Remove only this project's
    # running containers while preserving its volumes; never stop all projects.
    "$supabase_cli" --workdir "$service_dir" stop --project-id "$project_id" >>"$start_log" 2>&1 || true
  fi
  rm -f "$start_log"
}
trap cleanup EXIT
if ! "$supabase_cli" --workdir "$service_dir" start --ignore-health-check >"$start_log" 2>&1; then
  printf 'start-supabase: Supabase CLI start failed; captured output was omitted to protect credentials.\n' >&2
  exit 1
fi

api_port="${JOBFLOW_API_PORT:-15421}"
api_url="http://127.0.0.1:${api_port}/rest/v1/"
ready=0
for ((attempt = 1; attempt <= 90; attempt++)); do
  if curl --fail --silent --max-time 2 "$api_url" -o /dev/null; then
    ready=1
    break
  fi
  sleep 2
done
(( ready == 1 )) || {
  printf 'start-supabase: API did not become ready after 90 probes: %s\n' "$api_url" >&2
  exit 1
}

# Applying pending migrations is intentionally additive. This script never calls
# `supabase db reset` and never removes the project volume.
if ! "$supabase_cli" --workdir "$service_dir" migration up --local >>"$start_log" 2>&1; then
  printf 'start-supabase: migration failed; output omitted because SQL errors can contain private data. Inspect locally with a trusted administrator.\n' >&2
  exit 1
fi

printf 'JobFlow Supabase is running from %s (project %s).\n' "$service_dir" "$project_id"
