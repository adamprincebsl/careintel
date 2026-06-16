#!/usr/bin/env bash
# Create an Entra App Registration for this SWA and wire it into the SWA's
# auth settings. Run once per app, after deploy.sh has provisioned the SWA.
#
# Required env (or in .env):
#   APP_NAME    — app slug
#   TENANT_ID   — Beacon Entra tenant id
#
# Optional env:
#   RG          — defaults to RG-SWA-Prod

set -euo pipefail

[[ -f .env ]] && set -a && source .env && set +a

: "${APP_NAME:?APP_NAME is required}"
: "${TENANT_ID:?TENANT_ID is required}"
RG="${RG:-RG-SWA-Prod}"

SWA_NAME="swa-beacon-$APP_NAME"
SWA_HOSTNAME=$(az staticwebapp show --name "$SWA_NAME" --resource-group "$RG" --query defaultHostname -o tsv)
REDIRECT_URI="https://$SWA_HOSTNAME/.auth/login/aad/callback"
DISPLAY_NAME="beacon-$APP_NAME"

echo "==> Creating App Registration: $DISPLAY_NAME"
# --enable-id-token-issuance true: SWA's AAD sign-in requests response_type with
# id_token; without it Entra returns AADSTS700054 and the login spins.
APP_ID=$(az ad app create \
  --display-name "$DISPLAY_NAME" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "$REDIRECT_URI" \
  --enable-id-token-issuance true \
  --query appId -o tsv)

echo "    App (client) id: $APP_ID"
az ad app update --id "$APP_ID" --enable-id-token-issuance true --output none 2>/dev/null || true

echo "==> Creating client secret"
SECRET=$(az ad app credential reset \
  --id "$APP_ID" \
  --append \
  --display-name "swa-runtime" \
  --years 2 \
  --query password -o tsv)

echo "==> Writing AZURE_CLIENT_ID / AZURE_CLIENT_SECRET to SWA app settings"
az staticwebapp appsettings set \
  --name "$SWA_NAME" \
  --resource-group "$RG" \
  --setting-names \
      "AZURE_CLIENT_ID=$APP_ID" \
      "AZURE_CLIENT_SECRET=$SECRET" \
  --output none

# Single-tenant SWA sign-in needs an enterprise app (service principal) AND
# admin consent — the Beacon tenant disables user consent.
GRAPH_APP_ID='00000003-0000-0000-c000-000000000000'

echo "==> Ensuring service principal (enterprise app) exists"
az ad sp create --id "$APP_ID" --output none 2>/dev/null || echo "      (already exists)"

echo "==> Adding Microsoft Graph User.Read (delegated)"
az ad app permission add --id "$APP_ID" --api "$GRAPH_APP_ID" \
  --api-permissions e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope --output none 2>/dev/null || true

echo "==> Granting admin consent (needs Global Admin / Privileged Role Admin)"
if az ad app permission admin-consent --id "$APP_ID" 2>/dev/null; then
  echo "      Consent granted"
else
  echo "      WARN: couldn't grant admin consent automatically. In the portal:"
  echo "        Entra ID -> App registrations -> $DISPLAY_NAME -> API permissions"
  echo "        -> Grant admin consent for the tenant"
fi

echo
echo "Done."
echo
echo "Next: open staticwebapp.config.json and replace REPLACE_WITH_TENANT_ID with:"
echo "    $TENANT_ID"
echo "Then commit + push."
