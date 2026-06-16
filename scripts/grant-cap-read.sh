#!/usr/bin/env bash
# Grant the Beacon Care Intelligence Function App's managed identity READ-ONLY
# access to the cap app's Cosmos account (the system of record for all care data
# BCI reports on).
#
# Run this after deploy.sh has created the Function App's managed identity. The
# Bicep can't write this cross-RG role assignment itself.
#
# Usage:
#   ./scripts/grant-cap-read.sh [cap-cosmos-account] [cap-resource-group]
#
# Defaults: cosmos-beacon-capapp in RG-CAPAPP-Prod.

set -euo pipefail

CAP_ACCOUNT="${1:-cosmos-beacon-capapp}"
CAP_RG="${2:-RG-CAPAPP-Prod}"
FUNC_APP="${FUNC_APP:-func-beacon-care-intelligence}"
FUNC_RG="${FUNC_RG:-RG-SWA-Prod}"

# Cosmos DB Built-in Data Reader (data-plane role, NOT Azure RBAC).
READER_ROLE="00000000-0000-0000-0000-000000000001"

echo "==> Resolving $FUNC_APP managed identity principal..."
PRINCIPAL_ID=$(az functionapp identity show \
  --name "$FUNC_APP" --resource-group "$FUNC_RG" \
  --query principalId -o tsv)
echo "    principalId: $PRINCIPAL_ID"

echo "==> Granting Cosmos Data Reader on $CAP_ACCOUNT ..."
# MSYS_NO_PATHCONV=1: Git Bash on Windows otherwise rewrites the "/" scope into
# a Windows path, which Cosmos rejects.
MSYS_NO_PATHCONV=1 az cosmosdb sql role assignment create \
  --account-name "$CAP_ACCOUNT" \
  --resource-group "$CAP_RG" \
  --role-definition-id "$READER_ROLE" \
  --principal-id "$PRINCIPAL_ID" \
  --scope "/"

echo "Done. Beacon Care Intelligence can now READ the cap data (CAPs/Risks/Audits/Locations)."
