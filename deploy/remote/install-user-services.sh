#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
code_dir="${JOBFLOW_CODE_DIR:-$(cd -- "$script_dir/../.." && pwd)}"
service_dir="${JOBFLOW_SERVICE_DIR:-$HOME/service/jobflow-browser-extension}"
systemd_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
runtime_env="$service_dir/runtime.env"
runtime_supabase_dir="$service_dir/supabase"
source "$script_dir/common.sh"
validate_remote_path "$code_dir"
validate_remote_path "$service_dir"
validate_remote_path "$systemd_dir"

die() {
  printf 'remote install: %s\n' "$1" >&2
  exit 1
}

[[ -f "$code_dir/package.json" ]] || die "code directory does not contain package.json: $code_dir"
[[ -f "$code_dir/supabase/config.toml" ]] || die "code directory does not contain supabase/config.toml: $code_dir"
[[ -f "$script_dir/remote.env.example" ]] || die "missing remote.env.example"
[[ -f "$script_dir/service-README.md" ]] || die "missing service-README.md"

mkdir -p "$service_dir" "$runtime_supabase_dir" "$systemd_dir"

if [[ ! -e "$service_dir/README.md" ]]; then
  cp "$script_dir/service-README.md" "$service_dir/README.md"
  chmod 0644 "$service_dir/README.md"
fi

if [[ ! -e "$runtime_env" ]]; then
  cp "$script_dir/remote.env.example" "$runtime_env"
else
  printf 'Keeping existing runtime config: %s\n' "$runtime_env"
fi
chmod 600 "$runtime_env"

load_remote_config
if [[ -f "$runtime_supabase_dir/config.toml" ]]; then
  require_installed_remote_config
fi

sed \
  -e "s|__JOBFLOW_PROJECT_ID__|$JOBFLOW_PROJECT_ID|g" \
  -e "s|__JOBFLOW_API_PORT__|$JOBFLOW_API_PORT|g" \
  -e "s|__JOBFLOW_DB_PORT__|$JOBFLOW_DB_PORT|g" \
  -e "s|__JOBFLOW_DB_SHADOW_PORT__|$JOBFLOW_DB_SHADOW_PORT|g" \
  -e "s|__JOBFLOW_STUDIO_PORT__|$JOBFLOW_STUDIO_PORT|g" \
  -e "s|__JOBFLOW_INBUCKET_PORT__|$JOBFLOW_INBUCKET_PORT|g" \
  -e "s|__JOBFLOW_ANALYTICS_PORT__|$JOBFLOW_ANALYTICS_PORT|g" \
  "$script_dir/supabase.config.toml.template" > "$runtime_supabase_dir/config.toml"

link_source() {
  local source_path="$1"
  local target_path="$2"
  [[ -e "$source_path" ]] || die "missing source path: $source_path"
  if [[ -e "$target_path" && ! -L "$target_path" ]]; then
    die "refusing to replace a non-symlink runtime path: $target_path"
  fi
  ln -sfn "$source_path" "$target_path"
}

link_source "$code_dir/supabase/migrations" "$runtime_supabase_dir/migrations"
link_source "$code_dir/supabase/functions" "$runtime_supabase_dir/functions"
link_source "$code_dir/supabase/seed.sql" "$runtime_supabase_dir/seed.sql"

if [[ ! -e "$service_dir/model-gateway.env" ]]; then
  cp "$script_dir/model-gateway.env.example" "$service_dir/model-gateway.env"
  chmod 600 "$service_dir/model-gateway.env"
  printf 'Created empty model-gateway env file: %s\n' "$service_dir/model-gateway.env"
else
  printf 'Keeping existing model-gateway env file: %s\n' "$service_dir/model-gateway.env"
fi
chmod 600 "$service_dir/model-gateway.env"

sed \
  -e "s|__JOBFLOW_CODE_DIR__|$code_dir|g" \
  -e "s|__JOBFLOW_SERVICE_DIR__|$service_dir|g" \
  "$script_dir/jobflow-supabase.service.template" > "$systemd_dir/jobflow-supabase.service"
sed \
  -e "s|__JOBFLOW_CODE_DIR__|$code_dir|g" \
  -e "s|__JOBFLOW_SERVICE_DIR__|$service_dir|g" \
  "$script_dir/jobflow-model-gateway.service.template" > "$systemd_dir/jobflow-model-gateway.service"

systemctl --user daemon-reload
systemctl --user enable jobflow-supabase.service jobflow-model-gateway.service

printf '\nInstalled JobFlow user services.\n'
printf '%s\n' "  code:     $code_dir" "  runtime:  $service_dir" "  API port: $JOBFLOW_API_PORT"
printf '%s\n' \
  'Start:  systemctl --user start jobflow-supabase.service jobflow-model-gateway.service' \
  'Stop:   systemctl --user stop jobflow-model-gateway.service jobflow-supabase.service' \
  'Status: systemctl --user status jobflow-supabase.service jobflow-model-gateway.service' \
  'Logs:   journalctl --user -u jobflow-model-gateway.service -f'
printf '%s\n' 'The installer never runs supabase db reset and never deletes a database volume.'
printf '%s\n' 'Development stack only: configure Docker-aware network isolation before starting; an SSH tunnel does not hide published ports.'
