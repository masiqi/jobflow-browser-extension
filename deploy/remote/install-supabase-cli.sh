#!/usr/bin/env bash
set -Eeuo pipefail

service_dir="${JOBFLOW_SERVICE_DIR:-$HOME/service/jobflow-browser-extension}"
bin_dir="$service_dir/bin"
version="${SUPABASE_CLI_VERSION:-2.109.1}"
arch="$(uname -m)"
[[ "$(uname -s)" == Linux ]] || { printf 'install-supabase-cli: Linux only\n' >&2; exit 1; }
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'install-supabase-cli: invalid version\n' >&2; exit 1; }

case "$arch" in
  x86_64|amd64) asset="supabase_linux_amd64.tar.gz" ;;
  aarch64|arm64) asset="supabase_linux_arm64.tar.gz" ;;
  *)
    printf 'install-supabase-cli: unsupported architecture: %s\n' "$arch" >&2
    exit 1
    ;;
esac

mkdir -p "$bin_dir"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/supabase-cli.XXXXXX")"
trap 'rm -f "$tmp_dir/archive.tar.gz" "$tmp_dir/checksums.txt" "$tmp_dir/supabase"; rmdir "$tmp_dir"' EXIT

curl --fail --location --silent --show-error \
  "https://github.com/supabase/cli/releases/download/v${version}/${asset}" \
  --output "$tmp_dir/archive.tar.gz"
curl --fail --location --silent --show-error \
  "https://github.com/supabase/cli/releases/download/v${version}/checksums.txt" \
  --output "$tmp_dir/checksums.txt"
expected="$(awk -v asset="$asset" '$2 == asset { print $1 }' "$tmp_dir/checksums.txt")"
actual="$(sha256sum "$tmp_dir/archive.tar.gz")"
[[ "$expected" =~ ^[a-fA-F0-9]{64}$ && "${actual%% *}" == "$expected" ]] || {
  printf 'install-supabase-cli: release checksum mismatch; existing CLI was not changed\n' >&2
  exit 1
}
# Extract only the executable, without trusting archive paths or permissions.
tar --extract --gzip --to-stdout --file "$tmp_dir/archive.tar.gz" supabase > "$tmp_dir/supabase"
install -m 0755 "$tmp_dir/supabase" "$bin_dir/supabase"

"$bin_dir/supabase" --version
