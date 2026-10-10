#!/usr/bin/env bash
set -Eeuo pipefail

systemctl --user start jobflow-supabase.service
systemctl --user start jobflow-model-gateway.service
