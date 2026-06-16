#!/usr/bin/env bash
# Provision infrastructure and deploy the Bicep template into RG-SWA-Prod.
# Idempotent — safe to re-run after edits to main.bicep.
#
# Usage:
#   ./scripts/deploy.sh                          # uses defaults from .env
#   APP_NAME=care-intelligence ./scripts/deploy.sh
#
# Required env (or in .env at repo root):
#   APP_NAME              — app slug, lowercase, hyphenated (3–20 chars)
#
# Optional env:
#   RG                    — defaults to RG-SWA-Prod
#   LOCATION              — defaults to eastus2
#   SHARED_KV             — defaults to KV-SWA-APPS
#   ENABLE_FREE_TIER      — true/false, defaults to false (the cap account or a
#                           sibling app likely already claims the free tier)
#   AOAI_ACCOUNT          — existing Azure OpenAI account name (optional)
#   AOAI_RG               — RG of the AOAI account (defaults to $RG)
#   AOAI_ENDPOINT         — AOAI endpoint URL (empty => AI mock mode)
#   AOAI_DEPLOYMENT       — AOAI chat deployment name (empty => AI mock mode)

set -euo pipefail

[[ -f .env ]] && set -a && source .env && set +a

: "${APP_NAME:?APP_NAME is required}"
RG="${RG:-RG-SWA-Prod}"
LOCATION="${LOCATION:-eastus2}"
SHARED_KV="${SHARED_KV:-KV-SWA-APPS}"
ENABLE_FREE_TIER="${ENABLE_FREE_TIER:-false}"
AOAI_ACCOUNT="${AOAI_ACCOUNT:-}"
AOAI_RG="${AOAI_RG:-$RG}"
AOAI_ENDPOINT="${AOAI_ENDPOINT:-}"
AOAI_DEPLOYMENT="${AOAI_DEPLOYMENT:-}"

echo "==> Deploying $APP_NAME into $RG ($LOCATION)"

az deployment group create \
  --resource-group "$RG" \
  --template-file infra/main.bicep \
  --parameters \
      appName="$APP_NAME" \
      location="$LOCATION" \
      sharedKeyVaultName="$SHARED_KV" \
      enableCosmosFreeTier="$ENABLE_FREE_TIER" \
      aoaiAccountName="$AOAI_ACCOUNT" \
      aoaiResourceGroup="$AOAI_RG" \
      aoaiEndpoint="$AOAI_ENDPOINT" \
      aoaiDeployment="$AOAI_DEPLOYMENT" \
  --output table

echo "==> Done. Outputs:"
az deployment group show \
  --resource-group "$RG" \
  --name main \
  --query properties.outputs \
  --output json

echo
echo "Next: ./scripts/grant-cap-read.sh   (read-only role on the cap Cosmos account)"
echo "      ./scripts/setup-entra.sh       (Entra App Registration for SWA sign-in)"
