# Beacon Care Intelligence — Application Reference

The single-page reference for what this application is, how it's built, and how
it relates to the rest of the Beacon platform. Companion to [PLAN.md](PLAN.md)
(the feature roadmap) and [README.md](README.md) (run/deploy).

---

## 1. What it is

An **AI application + reporting tool** for **Beacon Specialized Living** (an
IDD/SMI residential provider operating in 8 states across ~528 programs). It sits
**on top of** the cap app ("Beacon Quality Manager", repo `beacon-capapp`) and
reads its data **read-only** to deliver:

1. **Reporting** — dashboards and report views over CAPs, Risks, Audits, and
   program performance (the cap app's system-of-record data).
2. **NL assistant** — a natural-language Q&A agent that answers questions about
   the care data with citations.
3. **AI narrative insights** — auto-generated executive summaries and trend/
   anomaly callouts layered on reports.
4. **AI-drafted reports** — full narrative reports (board packets, monthly
   quality summaries) generated from the underlying data, exportable to PDF.
5. **Predictive signals** — AI-derived risk flags / prioritization beyond the
   cap app's own scoring.

**Hosting / stack:**
- Azure Static Web Apps (Standard tier, Entra ID auth)
- Azure Functions (Node 20, v4 programming model) as backend
- Azure Cosmos DB Serverless — its **own** account for its own data
- Read-only access to the cap app's Cosmos for source data
- Azure OpenAI (managed identity) for the AI features — mock-safe
- GitHub Actions for CI/CD; Bicep for infra-as-code

**Deploys into:** the shared `RG-SWA-Prod` resource group, alongside
`beacon-dispatch`, `beacon-opportunity`, and the other Beacon micro-apps.

---

## 2. Relationship to the cap app (system of record)

Beacon Care Intelligence is a **consumer**, not an owner, of care data. The cap
app owns and mutates CAPs / Risks / Audits / Locations. BCI:

- **Reads** that data read-only via `api/src/lib/capData.js` (a second Cosmos
  client pointed at `cosmos-beacon-capapp` / `capapp`, granted the **Cosmos DB
  Built-in Data Reader** role). This mirrors how `beacon-dispatch` reads the cap
  app's `locations` + `careTeamAssignments` for routing.
- **Writes** only to its **own** account (`cosmos-beacon-care-intelligence` /
  `care-intelligence`) — saved reports, chat sessions, cached insights, signals.

Reading the source of truth directly (vs syncing a copy) keeps reporting always
current and avoids a sync pipeline.

---

## 3. Platform (shared services)

Identical seams to the rest of the Beacon platform — do not reinvent.

### 3.1 Identity & RBAC
- **Auth provider:** Microsoft Entra via SWA's built-in AAD provider. Sign-in is
  `/.auth/login/aad`. Config in `staticwebapp.config.json`.
- **Principal decode:** `api/src/lib/auth.js` decodes `x-ms-client-principal`
  (fails closed if absent). `MOCK_PRINCIPAL` stands in locally.
- **Permissions:** flat dotted-string IDs in `api/src/lib/permissions.js`,
  mirrored client-side in `web/src/lib/permissions.js`. Module gate
  `module.intelligence.access`; feature perms for `report.*`, `assistant.use`,
  `insight.view`, `signal.*`, `admin.manage`.
- **User record:** one Cosmos doc per Entra OID in the `users` container, joined
  at `/api/users/me`. Unprovisioned users land on an "Account not provisioned"
  panel until an admin assigns roles. Carries `clientScope` (`'*'` or
  `{ programIds, states }`) — the location axis gating identified client (PII)
  access; fail-closed when absent.
- **Provisioning:** `PUT /api/admin/users/{oid}` (gated `admin.manage`) sets a
  user's roles / permissions / `clientScope`. The **first** admin is seeded
  out-of-band with `api/scripts/provision-user.mjs` (the endpoint requires
  `admin.manage`, which nobody has until bootstrapped). Validation lives in
  `api/src/lib/userModel.js`.

### 3.2 Own database (Cosmos `care-intelligence`)

| Container | Partition | TTL | Purpose |
|---|---|---|---|
| `reports` | `/pk` | — | Saved / generated report documents |
| `chatSessions` | `/sessionId` | — | Assistant conversation history |
| `insights` | `/pk` | 1 day | Cached AI narrative insights |
| `signals` | `/pk` | — | Predictive risk-scoring outputs |
| `users` | `/pk` | — | Per-user profile + roles |
| `c360Schema` | `/pk` | — | Versioned c360 data dictionary (semantic context) |
| `c360Snapshots` | `/pk` | — | Nightly **de-identified** c360 rollups |
| `c360Vectors` | `/pk` | — | RAG embeddings of **non-PHI** content |
| `aiTurns` | `/userOid` | 90 day | Per-turn AI audit trail |
| `aiBudgets` | `/pk` | — | Per-user AI token/turn budgets |
| `accessLog` | `/pk` | — | PHI access audit (who/when/whichClientId/outcome) |
| `appSettings` | `/pk` | — | Feature flags + idle timeout (single doc id=`app`) |
| `auditLog` | `/pk` | — | Admin/config action audit (actor/action/before-after/when) |

All BCI Cosmos containers are **PHI-free**. Identified client data (names) is
**never stored** — it's read live from c360 and passed through to an authorized,
location-scoped viewer (`client.viewPii`), with each view audited. The c360 ERD +
full data model is in [docs/ERD.md](docs/ERD.md).

### 3.3 Read-only source data (cap app Cosmos `capapp`)
`caps`, `sourceEvents`, `actionItems`, `evidence`, `comments`, `risks`,
`riskMitigations`, `controls`, `riskControlLinks`, `riskCapLinks`, `locations`,
`entities`, `auditLog` (and the Audit module's containers as they ship).

### 3.4 AI layer (`api/src/lib/aoai.js`)
Single shared Azure OpenAI client. `completeText` / `completeJson` for single-
shot calls; the multi-turn tool-calling agent (chat) builds its own streaming
client. **Mock mode** when `AOAI_ENDPOINT`/`AOAI_DEPLOYMENT` are unset — every
AI feature degrades to a deterministic stub so the app runs with no AOAI.

---

## 4. Code map

```
api/src/
├── functions/
│   ├── health.js        # anonymous liveness (+ ai mode)
│   ├── users.js         # GET /api/users/me — profile + effective permissions
│   ├── metrics.js       # GET /api/metrics/overview — first read-only report
│   └── assistant.js     # POST /api/assistant/ask — single-shot AI (stub)
└── lib/
    ├── auth.js          # principal decode + requireAuth/requireRole
    ├── cosmos.js        # repo() helper for THIS app's own DB
    ├── capData.js       # READ-ONLY queries against the cap app's DB
    ├── aoai.js          # Azure OpenAI client + completion helpers (mock-safe)
    └── permissions.js   # catalog + system roles + can()/requirePermission()

web/src/
├── App.jsx              # router + auth gate + "not provisioned" panel
├── lib/{api,auth-context,permissions}.js(x)
├── components/TopNav.jsx
└── pages/{Dashboard,Assistant}.jsx
```

---

## 5. What's built vs planned

**Built (skeleton):** infra (Bicep), CI/CD, all shared libs, auth seam, own +
read-only Cosmos wiring, AOAI seam, one reporting endpoint (`metrics/overview`)
with live-or-sample fallback, a charts dashboard, and a single-shot assistant.

**Planned:** the report catalog, the tool-calling assistant over live data,
AI narrative insights, AI-drafted exportable reports, predictive signals, the
admin/RBAC UI, and PDF export. Full breakdown in [PLAN.md](PLAN.md).
