#!/usr/bin/env bash
set -Eeuo pipefail

systemctl --user stop jobflow-model-gateway.service jobflow-supabase.service
