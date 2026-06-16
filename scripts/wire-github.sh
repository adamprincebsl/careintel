#!/usr/bin/env bash
# Fetch the SWA deployment token and print the GitHub URL where you paste it
# as a repo secret named AZURE_STATIC_WEB_APPS_API_TOKEN. Run once per app.
#
# Required env (or in .env):
#   APP_NAME    — app slug
#   GITHUB_REPO — org/name, e.g. "adamprincebsl/beacon-care-intelligence"
#
# Optional env:
#   RG          — defaults to RG-SWA-Prod

set -euo pipefail

[[ -f .env ]] && set -a && source .env && set +a

: "${APP_NAME:?APP_NAME is required}"
: "${GITHUB_REPO:?GITHUB_REPO is required (e.g. adamprincebsl/beacon-care-intelligence)}"
RG="${RG:-RG-SWA-Prod}"

SWA_NAME="swa-beacon-$APP_NAME"

TOKEN=$(az staticwebapp secrets list \
  --name "$SWA_NAME" \
  --resource-group "$RG" \
  --query properties.apiKey -o tsv)

echo "Deploy token (copy now — it won't be shown again):"
echo
echo "    $TOKEN"
echo
echo "Paste it as AZURE_STATIC_WEB_APPS_API_TOKEN here:"
echo
echo "    https://github.com/$GITHUB_REPO/settings/secrets/actions/new"
echo
echo "Then push to main to trigger the first deploy."
