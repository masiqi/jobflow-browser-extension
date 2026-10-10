#!/usr/bin/env bash
# Shared validation for the development-only remote runtime. Never source user
# configuration: systemd EnvironmentFile and this parser accept literal values.

remote_die() {
  printf 'jobflow remote: %s\n' "$1" >&2
  exit 1
}

validate_remote_path() {
  [[ "$1" =~ ^/[a-zA-Z0-9_./-]+$ && "$1" != / && "$1" != *'/../'* && "$1" != */.. ]] ||
    remote_die 'runtime/code/config paths must be absolute and contain only letters, digits, _, ., / and -'
}

load_remote_config() {
  local line key value seen='|' ports='|'
  validate_remote_path "$service_dir"
  [[ -f "$service_dir/runtime.env" ]] || remote_die 'missing runtime.env; run install-user-services.sh first'
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" =~ ^(JOBFLOW_PROJECT_ID|JOBFLOW_API_PORT|JOBFLOW_DB_PORT|JOBFLOW_DB_SHADOW_PORT|JOBFLOW_STUDIO_PORT|JOBFLOW_INBUCKET_PORT|JOBFLOW_ANALYTICS_PORT)=([a-z0-9-]+)$ ]] ||
      remote_die 'invalid runtime.env entry; use unquoted literal template assignments only'
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    [[ "$seen" != *"|$key|"* ]] || remote_die 'duplicate runtime.env entry'
    seen+="$key|"
    if [[ "$key" == JOBFLOW_PROJECT_ID ]]; then
      [[ "$value" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || remote_die 'invalid project ID'
    else
      [[ "$value" =~ ^[1-9][0-9]{0,4}$ ]] && (( value <= 65535 )) || remote_die 'ports must be integers in 1..65535 without leading zeroes'
      [[ "$ports" != *"|$value|"* ]] || remote_die 'configured ports must be unique'
      ports+="$value|"
    fi
    printf -v "$key" '%s' "$value"
  done < "$service_dir/runtime.env"
  for key in JOBFLOW_PROJECT_ID JOBFLOW_API_PORT JOBFLOW_DB_PORT JOBFLOW_DB_SHADOW_PORT JOBFLOW_STUDIO_PORT JOBFLOW_INBUCKET_PORT JOBFLOW_ANALYTICS_PORT; do
    [[ "$seen" == *"|$key|"* ]] || remote_die "runtime.env is missing $key"
  done
}

require_installed_remote_config() {
  load_remote_config
  [[ -f "$service_dir/supabase/config.toml" ]] || remote_die 'missing installed Supabase config'
  local configured_id
  configured_id="$(sed -n 's/^project_id = "\([a-z0-9-]*\)"$/\1/p' "$service_dir/supabase/config.toml")"
  [[ "$configured_id" == "$JOBFLOW_PROJECT_ID" ]] || remote_die 'project ID differs from installed config; refusing to target a different project'
}

resolve_remote_cli() {
  supabase_cli="${JOBFLOW_SUPABASE_CLI:-$service_dir/bin/supabase}"
  if [[ ! -x "$supabase_cli" && -z "${JOBFLOW_SUPABASE_CLI:-}" ]]; then
    supabase_cli="$(command -v supabase || true)"
  fi
  [[ -n "$supabase_cli" && -x "$supabase_cli" ]] || remote_die 'Supabase CLI not found; run install-supabase-cli.sh or set JOBFLOW_SUPABASE_CLI'
}
