#!/usr/bin/env bash
set -Eeuo pipefail

service_dir="${JOBFLOW_SERVICE_DIR:-$PWD}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/common.sh"
require_installed_remote_config
resolve_remote_cli
project_id="$JOBFLOW_PROJECT_ID"

cd -- "$service_dir"
"$supabase_cli" --workdir "$service_dir" stop --project-id "$project_id"
