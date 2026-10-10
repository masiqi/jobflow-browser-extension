#!/usr/bin/env bash
set -Eeuo pipefail

service_dir="${JOBFLOW_SERVICE_DIR:-$PWD}"
model_env_file="${JOBFLOW_MODEL_ENV_FILE:-$service_dir/model-gateway.env}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/common.sh"
require_installed_remote_config
resolve_remote_cli

cd -- "$service_dir"
if [[ -f "$model_env_file" ]]; then
  exec "$supabase_cli" --workdir "$service_dir" functions serve model-gateway --env-file "$model_env_file"
fi

# BYOK remains available without a managed-model env file. The function still
# starts with JWT verification enabled by supabase/config.toml.
exec "$supabase_cli" --workdir "$service_dir" functions serve model-gateway
