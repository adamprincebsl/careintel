#!/usr/bin/env bash
# Smoke-test a deployed app. Run after the first GitHub Action completes.
# Exits 0 on full pass, 1 on any failure. Prints what passed and what didn't.
#
# Required env (or in .env):
#   APP_NAME    — app slug
#
# Optional env:
#   RG          — defaults to RG-SWA-Prod

set -euo pipefail

[[ -f .env ]] && set -a && source .env && set +a

: "${APP_NAME:?APP_NAME is required}"
RG="${RG:-RG-SWA-Prod}"

SWA_NAME="swa-beacon-$APP_NAME"
FUNC_NAME="func-beacon-$APP_NAME"
COSMOS_NAME="cosmos-beacon-$APP_NAME"

pass=0
fail=0
check() {
  local label="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "  ok    $label"
    pass=$((pass+1))
  else
    echo "  FAIL  $label"
    fail=$((fail+1))
  fi
}

echo "==> Verifying $APP_NAME"

SWA_HOSTNAME=$(az staticwebapp show --name "$SWA_NAME" --resource-group "$RG" --query defaultHostname -o tsv 2>/dev/null || true)
if [[ -z "$SWA_HOSTNAME" ]]; then
  echo "  FAIL  SWA $SWA_NAME not found in $RG"
  exit 1
fi
echo "      SWA: https://$SWA_HOSTNAME"

# 1. SWA root redirects unauthenticated requests to /.auth/login/aad
check "SWA enforces auth (302 to /.auth/login/aad)" \
  "[[ \$(curl -s -o /dev/null -w '%{http_code}' -L --max-redirs 0 https://$SWA_HOSTNAME/) == '302' ]]"

# 2. /api/health is reachable (anonymous endpoint)
check "/api/health responds 200" \
  "[[ \$(curl -s -o /dev/null -w '%{http_code}' https://$SWA_HOSTNAME/api/health) == '200' ]]"

# 3. /api/metrics/overview is auth-walled (401 without principal)
check "/api/metrics/overview requires auth" \
  "[[ \$(curl -s -o /dev/null -w '%{http_code}' https://$SWA_HOSTNAME/api/metrics/overview) == '401' ]]"

# 4. Cosmos role assignment exists for the Function App
PRINCIPAL_ID=$(az functionapp identity show --name "$FUNC_NAME" --resource-group "$RG" --query principalId -o tsv 2>/dev/null || true)
check "Function App managed identity assigned" "[[ -n '$PRINCIPAL_ID' ]]"

if [[ -n "$PRINCIPAL_ID" ]]; then
  check "Cosmos data-plane role assigned to Function App (own account)" \
    "az cosmosdb sql role assignment list --account-name '$COSMOS_NAME' --resource-group '$RG' --query \"[?principalId=='$PRINCIPAL_ID']\" -o tsv | grep -q ."
  check "Cosmos READ role assigned on cap account" \
    "az cosmosdb sql role assignment list --account-name 'cosmos-beacon-capapp' --resource-group 'RG-CAPAPP-Prod' --query \"[?principalId=='$PRINCIPAL_ID']\" -o tsv | grep -q ."
fi

# 5. Key Vault access role assigned
check "Key Vault Secrets User role assigned" \
  "az role assignment list --assignee '$PRINCIPAL_ID' --scope \$(az keyvault show --name \${SHARED_KV:-KV-SWA-APPS} --query id -o tsv) --query \"[?roleDefinitionName=='Key Vault Secrets User']\" -o tsv | grep -q ."

# 6. Function App has the cap Cosmos endpoint configured
check "Function App has CAP_COSMOS_ENDPOINT app setting" \
  "az functionapp config appsettings list --name '$FUNC_NAME' --resource-group '$RG' --query \"[?name=='CAP_COSMOS_ENDPOINT'].value\" -o tsv | grep -q ."

# 7. SWA has Entra app settings
check "SWA has AZURE_CLIENT_ID / AZURE_CLIENT_SECRET configured" \
  "az staticwebapp appsettings list --name '$SWA_NAME' --resource-group '$RG' --query 'properties.AZURE_CLIENT_ID' -o tsv | grep -q ."

echo
echo "==> $pass passed, $fail failed"
[[ $fail -eq 0 ]] || exit 1
