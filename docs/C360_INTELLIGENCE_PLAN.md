# c360 Intelligence — Plan

How Beacon Care Intelligence (BCI) adds **Azure AI over the c360 data** in
Microsoft Fabric: read it **read-only**, understand it, and persist **semantic
context + RAG vectors + aggregates + AI insights** in BCI's own Cosmos —
without storing client PHI in Cosmos.

This is a planning document. No code yet. It extends [PLAN.md](../PLAN.md)
(c360 becomes a second data domain alongside the cap-app data) and reuses the
patterns already proven in `beacon-capapp` (`fabric.js`) and the cap app's
Sprint 9 "AI Data Q&A Agent" design.

---

## 1. Locked decisions

| Decision | Choice | Implication |
|---|---|---|
| **c360 source** | Microsoft Fabric warehouse **`core-prod-db`** (same workspace as `BSL_Silver_Warehouse`) | Reuse the `fabric.js` read-only pattern: `mssql` over TDS/1433, Entra token (`https://database.windows.net/.default`), MI granted **Viewer** on the workspace. No new connection tech, no writes. |
| **PHI posture** | Raw rows may go to **Azure OpenAI under the BAA**; **Cosmos stays PHI-free** | Aggregate / de-identify before persisting. Only rollups, metrics, and de-identified insights land in Cosmos. |
| **Persist in Cosmos** | Semantic/schema context · RAG vectors · derived aggregates · AI insights | New containers (see §5). |
| **AI query model** | **Curated tool catalog** (no free-form SQL) | The model calls vetted, parameterized, read-only queries. Authorization + audit run unchanged; the model never touches the warehouse directly. |

---

## 2. The PHI boundary (the load-bearing constraint)

c360 is client-level data. The rule "**PHI may reach AOAI (BAA), but Cosmos
stays PHI-free**" defines exactly where each kind of data may flow:

```
 Fabric c360 (PHI)  ──read-only──►  BCI Functions
        │                               │
        │ raw rows (PHI)                │  de-identify / aggregate IN FLIGHT
        ▼                               ▼
   Azure OpenAI  ◄──(BAA)──  prompt    Cosmos (PHI-FREE)
   (analysis,                          • semantic context (schema/glossary)
    narration)                         • aggregates / rollups / KPIs
        │                              • AI insights (de-identified)
        │ narrative back               • RAG vectors of NON-PHI content only
        ▼                              • audit log of every AI turn
   to the user (scope-checked)
```

**Hard rules the build must enforce:**

1. **No raw client rows persisted to Cosmos.** Tool outputs that touch PHI are
   aggregated/de-identified before any `cosmos.js` write.
2. **Vectors can leak PHI.** An embedding of raw client narrative is
   reconstructable → treat as PHI. Therefore **Cosmos RAG vectors cover only
   non-PHI content**: the data dictionary, business glossary, metric
   definitions, and de-identified rollup summaries. *If* client-narrative RAG is
   ever needed, it goes in **Azure AI Search** under PHI controls — never the
   PHI-free Cosmos.
3. **Every AOAI call is logged** (tool-call trace + token counts) to an audit
   container; transcripts that could carry PHI get the BAA-aligned retention
   policy (default 90 days, admin-purgeable).
4. **Scope-aware.** Tool outputs respect the caller's permissions + location
   scope (BCI inherits the cap-app RBAC model) so a user never sees data they
   aren't entitled to.

**Sanctioned exception — identified client display (pass-through).** Some
surfaces legitimately need a client's *name* (e.g. the **client detail page**).
This is allowed **without breaking the PHI-free-Cosmos rule** via a strict
pass-through: read the identified row **live from c360 per request**, return it
to an authorized caller, and **never persist it** (no Cosmos, no cache, no
embedding, response marked `no-store`). It is gated by the `client.viewPii`
permission **and** location scope (`clientInScope`), and **every view is
audit-logged** to the `accessLog` container — which records *who / when / which
ClientId / outcome*, never the name or other PHI. (Storing the accessed ClientId
is required for HIPAA access logging and is itself not a name/DOB.)
Implemented in `lib/clientLookup.js` + `functions/clients.js`. The projection is
**minimum-necessary** — name + program/location + enrollment dates only; **DOB
and other identifiers are not selected**, so they never leave c360.

---

## 3. Architecture

c360 is a **second read-only data domain** in BCI, parallel to the cap-app
Cosmos data. It plugs into the same three surfaces from [PLAN.md](../PLAN.md):
reporting, AI insights, and the assistant.

```
                         ┌─────────────────────────────────────────┐
                         │              BCI Functions               │
 Fabric c360 ──RO(MI)──► │  fabricC360.js   c360Tools.js (catalog)  │ ──► Cosmos (own, PHI-free)
 (warehouse)             │  c360Context.js  c360Aggregate.js        │      reports/insights/
                         │  aoai.js / chat.js   ragIndex.js         │      signals/users + NEW:
                         └───────┬───────────────────┬──────────────┘      c360Schema, c360Vectors,
                                 │ aggregates+insights│ embeddings           c360Snapshots, aiTurns
                                 ▼                    ▼
                          Cosmos (cache)        Cosmos vector / Azure AI Search
```

---

## 4. Components

### 4.1 `fabricC360.js` — read-only connection
Clone of `beacon-capapp/api/src/lib/fabric.js`, pointed at the c360 warehouse via
new env vars. Same lazy pool + Entra token + Viewer-only grant.
`c360Query(sql, params)` returns recordsets. **Never** exposed to the model directly.

**Connection (confirmed):**

| Setting | Value |
|---|---|
| `FABRIC_C360_SQL_ENDPOINT` | `4trxo4y44m3e7byjyu2g7pz6le-xdpozjn34hau3cztgs66ay2wlm.datawarehouse.fabric.microsoft.com` |
| `FABRIC_C360_WAREHOUSE_NAME` | `core-prod-db` |
| Port / protocol | 1433, SQL Server TDS, `Encrypt=True`, `TrustServerCertificate=False` |
| Auth (our app) | Entra access token via `DefaultAzureCredential` — **MI in Azure, `az login` locally** (the source string's `ActiveDirectoryInteractive` is SSMS-only) |

Notes:
- The endpoint shares the workspace prefix `4trxo4y44m3e7byjyu2g7pz6le` with the
  cap app's `BSL_Silver_Warehouse` (suffix `eo5pefo6cu5uzfxow32yfycs5q`), so
  **c360 is a different warehouse item in the same Fabric workspace** — the
  Viewer-grant procedure in the cap app's `docs/FABRIC_SETUP.md` applies
  verbatim. BCI's Function App has its **own** managed identity, so it still
  needs its own Viewer grant (the cap app's MI grant doesn't extend to it).
- `core-prod-db` is named "core/prod" rather than a medallion tier (Silver/Gold)
  — **confirm the layer** (raw vs curated) with the data team so the
  de-identification + aggregation step is correct (§8.3).
- The app manages its own pool (`fabric.js` uses `pool.max:5`); the source
  string's `Pooling=False` / `MultipleActiveResultSets=False` are SSMS settings,
  not ours.

### 4.2 Semantic / schema context (`c360Context.js` → `c360Schema` container)
A learned **data dictionary** of c360, so the AI reasons over meaning, not raw
column names:
- Enumerate tables/columns/types (adapt `dump-fabric-schema.mjs`).
- Attach human descriptions, the join graph, metric definitions, and a business
  glossary (e.g. "active census", "length of stay", "admission cohort").
- Store as versioned docs in `c360Schema` (PHI-free — it's metadata).
- Refreshed by a maintained job when the warehouse schema changes; drives both
  tool design and any future guarded text-to-SQL.

### 4.3 Curated tool catalog (`c360Tools.js`)
~15–25 vetted, parameterized, read-only queries the model can call — each
returns **small structured JSON (aggregates), never raw client lists**. Starter
set (refine with a "top 10 questions" working session):
- **Census & cohorts:** `census_by_program`, `census_trend_by_month`,
  `admissions_vs_discharges_by_quarter`, `length_of_stay_distribution`
- **Cross-domain (c360 × cap data):** `programs_with_high_acuity_and_open_caps`,
  `census_vs_risk_posture_by_market`
- **Top/bottom N:** `programs_by_occupancy`, `cohorts_by_growth`
- **Drill-by-id:** `get_program_census_summary` (aggregated, de-identified)
Each tool: input schema the model fills, a fixed SQL template (parameterized),
an aggregation/de-identify step, scope enforcement, and a small JSON return.

### 4.4 Aggregation / snapshot jobs (`c360Aggregate.js` → `c360Snapshots`)
Timer-triggered (nightly; `alwaysOn` already set) jobs that pull c360, compute
**PHI-free rollups** (occupancy, census trends, cohort KPIs), and upsert
idempotently to `c360Snapshots` with a run-history row. Dashboards + the
assistant read these for speed; raw c360 is hit live only for fresh tool calls.

### 4.5 RAG index (`ragIndex.js` → `c360Vectors` or Azure AI Search)
- **In Cosmos (default):** embed **non-PHI** content only — data dictionary,
  glossary, metric defs, de-identified snapshot summaries — with AOAI
  `text-embedding-3-small`; store vectors in `c360Vectors` using Cosmos NoSQL
  **vector search** (DiskANN vector-indexing policy). Powers "what does X mean /
  which metric covers Y" retrieval.
- **In Azure AI Search (only if client-narrative RAG is required):** a separate,
  PHI-controlled index. Kept out of the PHI-free Cosmos by design.

### 4.6 AI insights (`completeText`/`completeJson` → `insights`)
De-identified narrative summaries + anomaly/trend callouts over the aggregates
(reusing BCI's existing `insights` container + TTL). "Census in the MN market is
trending down 8% QoQ" — computed from rollups, no client rows.

### 4.7 Assistant integration
Extends the BCI assistant (PLAN.md Phase 3): the c360 tools join the cap-data
tools in one catalog. The chat handler injects the caller's principal into every
tool call, logs each turn to `aiTurns`, and enforces per-user token budgets.

---

## 5. Cosmos schema additions (PHI-free)

| Container | Partition | TTL | Purpose |
|---|---|---|---|
| `c360Schema` | `/pk` | — | Versioned semantic/schema context (data dictionary, join graph, glossary, metric defs) |
| `c360Snapshots` | `/pk` | — | Nightly de-identified rollups / KPIs / cohort summaries |
| `c360Vectors` | `/pk` | — | Embeddings of **non-PHI** content for RAG (Cosmos vector search) |
| `aiTurns` | `/userOid` | 90d | Per-turn AI audit (prompt, tool calls, token counts, response) |
| `aiBudgets` | `/pk` | — | Per-user token/turn budget counters |
| `accessLog` | `/pk` | — | PHI **access** audit (who/when/whichClientId/outcome) — never the name |

(`reports`, `insights`, `signals`, `users` already exist.)

---

## 6. Infra / env additions (Bicep)

- **Env vars** on the Function App (values confirmed):
  - `FABRIC_C360_SQL_ENDPOINT=4trxo4y44m3e7byjyu2g7pz6le-xdpozjn34hau3cztgs66ay2wlm.datawarehouse.fabric.microsoft.com`
  - `FABRIC_C360_WAREHOUSE_NAME=core-prod-db`
  - `AOAI_EMBEDDING_DEPLOYMENT` for RAG (still to provision).
- **Grant (out-of-band, manual):** the BCI Function App's managed identity needs
  **Viewer** on the c360 Fabric workspace (Fabric portal → Manage access — same
  procedure as `docs/FABRIC_SETUP.md` in the cap app). Fabric grants aren't
  expressible in Bicep.
- **AOAI:** add an embedding model deployment alongside the chat deployment.
- **Containers:** add the five rows above to the `containers` array in
  `infra/main.bicep`. Enable the **vector indexing policy** on `c360Vectors`.
- **Cost alerts:** Azure Monitor budget alert on AOAI spend (per cap-app Sprint 9).
- **Dependency:** add `mssql` to `api/package.json` (the SQL client).

---

## 7. Phasing

| Phase | Deliverable | Exit |
|---|---|---|
| **C0 — Connect** | ✅ `fabricC360.js` + admin-only `/api/internal/c360-health` + `scripts/dump-c360-schema.mjs` | Health endpoint returns table count from c360 — confirm from corp network or Azure (see §4.1 note) |
| **C1 — Context** | ✅ Dictionary pipeline scaffolded — `c360Context.buildDictionary` (pure merge), `scripts/load-c360-dictionary.mjs` (`--dry-run` + Cosmos load), `GET /api/c360/schema`, `docs/c360-annotations.example.json`. **Remaining:** run the dump, author real annotations, load + data-owner review. | Dictionary persisted + reviewed by the data owner |
| **C2 — Aggregates** | ✅ Scaffolded — `c360Aggregate.js` (de-id guardrails: `assertSafeColumns`, `suppressSmallCells`, snapshot builder — unit-tested), `c360Rollups.js` (illustrative defs), `c360SnapshotTimer` (nightly), `GET /api/c360/metrics`, **SPA `/c360` report page** (rollup picker + chart + table, de-id badges). **Remaining:** replace illustrative rollups with real ones once the dictionary is reviewed. | Dashboard shows live census/occupancy rollups |
| **C3 — Tools + Assistant** | Curated c360 tool catalog wired into the assistant; `aiTurns`/`aiBudgets`; audit + scope enforcement | "Census trend in MN this year?" answered correctly with citations |
| **C4 — RAG** | Non-PHI vector index in `c360Vectors`; `search_context` tool | "What does 'active census' mean / which metric?" answered from retrieval |
| **C5 — Insights & signals** | De-identified AI narratives + predictive signals over c360 | Insight cards on c360 reports; nightly signals populated |
| **Cc — Client display** | ✅ Scaffolded — `client.viewPii` perm + location scope + `accessLog` audit; `GET /api/clients/{id}` (live pass-through, `no-store`, never persisted, minimum-necessary projection: name + program, **no DOB**); SPA client-detail page; **provisioning** via `PUT /api/admin/users/{oid}` + `scripts/provision-user.mjs` (sets roles + `clientScope`). **Remaining:** finalize the live projection against the real dictionary. | Authorized, scoped user views a client's name live; the view is audited; nothing persisted |

C0–C2 are the foundation; C3 is the headline AI capability; C4–C5 layer on.

---

## 8. Inputs to confirm with the data team

1. ~~**c360 warehouse identity**~~ ✅ **Resolved** — endpoint
   `4trxo4y44m3e7byjyu2g7pz6le-xdpozjn34hau3cztgs66ay2wlm.datawarehouse.fabric.microsoft.com`,
   warehouse `core-prod-db`, same Fabric workspace as `BSL_Silver_Warehouse`.
   *Still confirm:* the medallion **tier/layer** of `core-prod-db` (raw vs
   curated) so de-identification (§8.3) targets the right columns.
2. **BAA coverage** — written confirmation the BAA covers Azure OpenAI usage in
   our region before any raw c360 row is sent to AOAI.
3. **De-identification spec** — which fields are identifiers (so the in-flight
   aggregation/de-identify step is correct), and the minimum aggregation
   granularity allowed (e.g. suppress cells < N clients).
4. **Top 10 questions** users would actually ask of c360 — shapes the tool
   catalog more than anything else (30-min working session).
5. **Retention** — confirm 90-day `aiTurns` retention aligns with PHI policy
   (transcripts may echo PHI even though Cosmos rows don't store source PHI).
6. **Embedding model availability/quota** in-region.

---

## 9. Risks & mitigations

- **PHI leakage via vectors** → embed non-PHI content only in Cosmos; client-
  narrative RAG (if ever) goes to PHI-controlled Azure AI Search. (§2)
- **PHI leakage via tool outputs** → aggregate/de-identify + cell suppression
  before any persist or display; review every tool's output shape.
- **Warehouse load / cost** → cache via nightly snapshots; live queries are
  bounded + parameterized; AOAI token budgets + cost alerts.
- **Schema drift** → the `c360Schema` refresh job + versioning; tools fail
  loudly (not silently) when a referenced column disappears.
- **Authorization gaps** → tools run through the same principal/scope checks as
  the rest of BCI; the model can't issue free-form SQL.
- **Hallucinated numbers** → the model only reports values returned by tools;
  system prompt forbids inventing figures; insights stamp "data as of <ts>".
```
