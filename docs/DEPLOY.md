# Deploy runbook — Beacon Care Intelligence

Status: **prerequisites validated, template valid, blocked on one quota increase.**
Subscription `SWA Apps` (`313077c5-2a2a-46f5-8eaf-0ee6948aef8c`), RG `RG-SWA-Prod`,
tenant `7377e3e4-…`. `.env` is set (APP_NAME, TENANT_ID, GITHUB_REPO=adamprincebsl/careintel).

## Validated already
- ✅ `RG-SWA-Prod`, shared `KV-SWA-APPS`, and cap Cosmos `cosmos-beacon-capapp` all exist.
- ✅ No name collision (`swa-beacon-care-intelligence` not present).
- ✅ Bicep compiles + passes preflight validation (after removing the cross-RG
  AOAI role assignment — now granted out-of-band).

## ⛔ Blocker — B1 compute quota (action: you, in the portal)
Preflight: **B1 VMs in East US 2 — limit 2, usage 2** (both used by
`plan-beacon-dispatch` + `plan-beacon-opportunity`). A dedicated
`plan-beacon-care-intelligence` needs a 3rd.

**Request to file** (Azure Portal → **Quotas** → Compute / App Service, or a
support "Service and subscription limits (quotas)" request):
- Subscription: **SWA Apps**
- Provider/quota: **App Service — B1 (Basic) Linux workers** ("B1 VMs")
- Region: **East US 2**
- Current limit: **2** → **request 4** (3 needed + headroom)

Small App Service bumps are usually auto-approved within minutes–hours.

## Resume once quota is approved
```bash
cd beacon-care-intelligence
./scripts/deploy.sh            # provisions SWA + Function App + Cosmos + RBAC (Bicep)
./scripts/grant-cap-read.sh    # read-only role on cosmos-beacon-capapp for the FA managed identity
./scripts/setup-entra.sh       # Entra App Registration for SWA sign-in
# edit staticwebapp.config.json: replace REPLACE_WITH_TENANT_ID with 7377e3e4-…
git push                       # (already pushed) — then:
./scripts/wire-github.sh       # prints SWA deploy token → add as GitHub secret AZURE_STATIC_WEB_APPS_API_TOKEN
./scripts/setup-deploy-credentials.sh   # OIDC deploy app reg → 3 GitHub secrets
# add the 4 secrets to the GitHub repo, then push to main to trigger CI build
./scripts/verify.sh            # smoke test (auth wall, health, cosmos roles, etc.)
```

## Post-deploy grants (out-of-band — can't be done in Bicep)
1. **Fabric Viewer** for the app's managed identity (unblocks c360):
   - get principal: `az functionapp identity show -n func-beacon-care-intelligence -g RG-SWA-Prod --query principalId -o tsv`
   - Fabric portal → the workspace with `core-prod-db` → Manage access → add that
     identity as **Viewer**.
2. **Azure OpenAI** (when AI-over-PHI goes live): grant the same identity
   **Cognitive Services OpenAI User** on the AOAI account, and set
   `AOAI_ENDPOINT` / `AOAI_DEPLOYMENT` app settings (+ enable the no-human-review
   path — SECURITY.md).
3. **First admin**: `node api/scripts/provision-user.mjs --oid=<your Entra oid> --email=adam.prince@beaconspecialized.org --roles=CI_Admin --scope=*`

## First validation after deploy
Sign in → **Explore** (stable Fabric link from Azure) → confirm the data pulls:
`GET /api/internal/c360-health`, then profile Day Hab etc. via
`GET /api/c360/notes/profile?table=BSL_ServiceNoteDayHabilitation`.
