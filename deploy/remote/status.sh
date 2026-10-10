#!/usr/bin/env bash
set -Eeuo pipefail

service_dir="${JOBFLOW_SERVICE_DIR:-$HOME/service/jobflow-browser-extension}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/common.sh"
require_installed_remote_config
resolve_remote_cli
systemctl --user --no-pager status jobflow-supabase.service jobflow-model-gateway.service || true
if [[ -d "$service_dir" ]]; then
  printf '\nSupabase endpoints (sensitive keys omitted):\n'
  if [[ -n "$supabase_cli" && -x "$supabase_cli" ]]; then
    status_file="$(mktemp "${TMPDIR:-/tmp}/jobflow-supabase-status.XXXXXX")"
    trap 'rm -f "$status_file"' EXIT
    if ! (cd -- "$service_dir" && "$supabase_cli" --workdir "$service_dir" status -o env >"$status_file" 2>&1); then
      printf 'status: Supabase CLI status failed; inspect the service journal on the host.\n' >&2
      exit 1
    fi
    awk -F= '$1 ~ /^(API_URL|REST_URL|FUNCTIONS_URL|GRAPHQL_URL|STUDIO_URL)$/ { print }' "$status_file"
  else
    printf 'status: Supabase CLI not found; set JOBFLOW_SUPABASE_CLI or run deploy/remote/install-supabase-cli.sh\n' >&2
    exit 1
  fi
fi
