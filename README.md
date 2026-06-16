# Beacon Care Intelligence

AI-powered analytics & reporting for **Beacon Specialized Living**. A read-only
intelligence layer on top of the cap app ("Beacon Quality Manager") that turns
the live CAP / Risk / Audit / Location data into dashboards, AI-drafted reports,
predictive risk signals, and a natural-language assistant.

This repo is **stamped from the Beacon SWA micro-app pattern** (same as
`beacon-capapp` and `beacon-dispatch`): Azure Static Web App (Entra auth) +
linked Azure Functions (Node 20) + Cosmos DB Serverless, deployed via Bicep into
`RG-SWA-Prod` with CI/CD through GitHub Actions.

> **Status: skeleton.** Shared platform (auth, own Cosmos, read-only cap data,
> AOAI) is wired and runs locally in mock mode. The full feature build is laid
> out in [PLAN.md](PLAN.md). Architecture reference: [APPLICATION.md](APPLICATION.md).

## Stack

- **Frontend** — React 18 + Vite SPA (React Query, Recharts, Tailwind w/ Beacon brand tokens)
- **Backend** — Azure Functions (Node 20, programming model v4)
- **Own data** — Cosmos DB Serverless (`cosmos-beacon-care-intelligence` / `care-intelligence`): `reports`, `chatSessions`, `insights` (TTL), `signals`, `users`
- **Core data** — READ-ONLY from the cap app's Cosmos (`cosmos-beacon-capapp` / `capapp`): CAPs, Risks, Audits, Locations
- **AI** — Azure OpenAI via managed identity (mock-safe — runs without AOAI provisioned)
- **Auth** — Entra ID at the SWA edge; Functions trust `x-ms-client-principal`
- **Infra** — Bicep into the shared `RG-SWA-Prod`

## Architecture at a glance

```
Browser (Entra) ──► SWA edge auth ──► React SPA
                                       │  /api/* (linked Function App)
                                       ▼
        ┌─────────── Azure Functions (Node 20) ───────────┐
        │  auth.js   cosmos.js (own DB)   capData.js (RO)  │
        │  aoai.js   permissions.js                        │
        │  functions: health · users/me · metrics · assistant │
        └──────┬───────────────────┬──────────────┬───────┘
               │ read/write         │ read-only    │ AI
               ▼                    ▼              ▼
   cosmos-beacon-care-      cosmos-beacon-     Azure OpenAI
   intelligence (own)       capapp (RO)        (managed identity)
```

## Local development

```powershell
# Terminal 1 — Functions backend (mock mode: no AOAI, sample metrics fallback)
cd api
copy local.settings.json.example local.settings.json
npm install
npm start                 # Functions runtime on :7071

# Terminal 2 — Vite SPA
cd web
npm install
npm run dev               # http://localhost:4280, proxies /api → :7071
```

With `AOAI_*` unset the assistant + insights run in deterministic **mock mode**.
With no cap Cosmos reachable, `/api/metrics/overview` returns a sample payload so
the dashboard renders. `MOCK_PRINCIPAL` in `local.settings.json` stands in for
the SWA principal so `requireAuth()` passes locally.

## Provision & deploy

```bash
# 1. Edit .env: APP_NAME, TENANT_ID, GITHUB_REPO (+ optional AOAI_*)
./scripts/deploy.sh             # Bicep: SWA + Functions + Cosmos + RBAC
./scripts/grant-cap-read.sh     # read-only role on cosmos-beacon-capapp
./scripts/setup-entra.sh        # Entra App Registration for SWA sign-in
# 2. Replace REPLACE_WITH_TENANT_ID in staticwebapp.config.json
git add . && git commit -m "Initial commit" && git push   # create the GitHub repo first
./scripts/wire-github.sh        # paste SWA deploy token as a repo secret
./scripts/verify.sh             # 8-point smoke test
```

CI/CD is `.github/workflows/azure-static-web-apps.yml`.

## Where things live

```
beacon-care-intelligence/
├── api/                       # Azure Functions (Node 20, v4)
│   └── src/
│       ├── functions/         # health · users · metrics · assistant
│       └── lib/               # auth · cosmos (own) · capData (RO) · aoai · permissions
├── web/                       # React + Vite SPA
│   └── src/{components,lib,pages}
├── infra/main.bicep           # SWA + Functions + Cosmos + AOAI RBAC + read-only cap wiring
├── scripts/                   # deploy · grant-cap-read · setup-entra · wire-github · verify
├── APPLICATION.md             # architecture reference
└── PLAN.md                    # the feature build plan
```
