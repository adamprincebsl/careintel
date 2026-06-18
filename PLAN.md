# Beacon Care Intelligence — Build Plan

The skeleton (this commit) wires the shared platform end-to-end and runs locally
in mock mode. This plan turns it into the full AI + reporting product. Phases are
ordered so each builds on a working app; every phase ends shippable.

Conventions to follow (don't reinvent): read source data only through
`capData.js`; persist only to the app's own DB through `cosmos.js`; gate every
endpoint with `requireAuth` + a `permissions.js` check; keep all AI calls
mock-safe via `aoai.js`; mirror any new permission into `web/src/lib/permissions.js`.

---

> **Second data domain — c360.** Beyond the cap-app Cosmos data, BCI also reads
> the **c360 data in Microsoft Fabric** (read-only) and layers Azure AI over it,
> persisting semantic context + RAG vectors + aggregates + insights in Cosmos
> (PHI-free). That track has its own design: [docs/C360_INTELLIGENCE_PLAN.md](docs/C360_INTELLIGENCE_PLAN.md).
> Its phases (C0–C5) run in parallel with / fold into Phases 1–5 below.

## Phase 0 — Skeleton ✅ (done)

- Bicep (SWA + Functions + own Cosmos + AOAI RBAC + read-only cap wiring), CI/CD,
  deploy/verify scripts.
- Shared libs: `auth`, `cosmos` (own), `capData` (read-only), `aoai` (mock-safe), `permissions`.
- Endpoints: `health`, `users/me`, `metrics/overview` (live-or-sample), `assistant/ask` (single-shot).
- React SPA shell: auth gate, "not provisioned" panel, dashboard with one chart, assistant chat.

**Exit:** `npm start` (api) + `npm run dev` (web) → sign-in (mock) → dashboard + assistant render.

---

## Phase 1 — Reporting foundation

Goal: a real, navigable report catalog over the read-only cap data.

1. **Query layer** — extend `capData.js` with projected, parameterized readers:
   `capsByState`, `capsBySeverity`, `capsAging` (0–30/31–60/61–90/90+ buckets),
   `risksByCategory`, `riskHeatmap` (5×5 population), `auditPassRate` (when the
   Audit module data lands), `programRollup` (State→Market→Area→District→Program).
   Keep queries projected (`SELECT c.field …`) — never `SELECT *` for list views.
2. **Endpoints** — `GET /api/reports/:key` dispatching to the readers above, each
   gated by `report.view`. Add a `?state=&market=&from=&to=` filter contract.
3. **Caching** — wrap expensive roll-ups in the `insights`/a `reportCache`
   container with short TTL to keep RU usage low (Serverless is per-request RU).
4. **SPA** — a `pages/reports/` directory: report picker + filter bar +
   Recharts views (bars, the 5×5 heatmap as a grid, aging stacked bars). Reuse
   the `Kpi` + chart patterns already in `Dashboard.jsx`.
5. **Geographic drill** — US-states choropleth → market → program card drill,
   matching the cap app's `react-simple-maps` approach (no lat/lng yet).

**Exit:** an analyst can browse CAP + Risk reports, filter by state/date, and drill the map.

---

## Phase 2 — AI narrative insights (`insight.view`)

Goal: every report can carry an AI-written executive summary + callouts.

1. `lib/insights.js` — builds a compact, **pre-aggregated** context (never raw
   PHI rows) from a report's roll-up, calls `completeText`/`completeJson` for a
   summary + ranked callouts (e.g. "Ohio overdue CAPs up 40% QoQ").
2. `GET /api/reports/:key/insight` — returns `{ summary, callouts[], asOf, mock }`,
   cached in `insights` (1-day TTL container already in Bicep). Gate `insight.view`.
3. SPA — an "AI summary" card atop each report; shows a MOCK badge in mock mode.
4. **Guardrails** — system prompt forbids inventing figures; pass only computed
   aggregates; show "based on data as of <ts>". Log token usage to App Insights.

**Exit:** opening a report shows a grounded narrative summary; mock mode degrades cleanly.

---

## Phase 3 — NL assistant over live data (`assistant.use`)

Goal: replace the single-shot stub with a tool-calling agent that answers from
live data with citations, across multi-turn sessions.

1. `lib/chat.js` — streaming AOAI client with **tool calling**. Tools map 1:1 to
   safe `capData.js` readers (`getCapMetrics`, `listOverdueCaps`, `getRiskHeatmap`,
   `getProgramRollup`, …) — the model can only call vetted, read-only, projected
   queries (no free-form SQL). Each tool returns aggregates + ids for citation.
2. `POST /api/assistant/ask` (rework) + `GET/POST /api/assistant/sessions` —
   persist turns to `chatSessions` (`/sessionId`). Stream tokens via SSE/chunked.
3. SPA — upgrade `Assistant.jsx`: streaming render, session list, clickable
   citations that deep-link into the matching report/CAP.
4. **Safety** — strip/avoid PHI in tool outputs; enforce the caller's location
   scope (resolve allowed locations like the cap app) so answers respect RBAC.

**Exit:** "Which programs have the most overdue CAPs?" returns a correct,
cited answer computed live; conversation persists.

---

## Phase 4 — AI-drafted reports + export (`report.create`, `report.export`)

Goal: generate full narrative reports and export them.

1. `lib/reportGen.js` — assemble a report spec (sections, the roll-ups each needs)
   → fetch aggregates → `completeText` per section → stitch a structured doc
   stored in `reports` (`/pk`). Templates: "Monthly Quality Summary",
   "Quarterly Board Packet", "Program Spotlight".
2. Endpoints — `POST /api/reports` (generate+save), `GET /api/reports`,
   `GET /api/reports/:id`. Gate `report.create`.
3. **PDF export** — Beacon-branded PDF. Reuse the cap app's print approach
   (print stylesheet + browser print) for v1; evaluate a server-side renderer
   (Puppeteer in a separate Function or the `pdf` skill) if pixel-perfect output
   is required. Gate `report.export`.
4. SPA — report builder (pick template + scope), saved-reports list, viewer.

**Exit:** generate a Monthly Quality Summary, save it, view it, export to PDF.

---

## Phase 5 — Predictive / risk-scoring signals (`signal.view`, `signal.manage`)

Goal: AI-derived flags beyond the cap app's own scoring.

1. **Signal engine** — a Timer-trigger Function (e.g. nightly) that reads cap data
   read-only, computes candidate signals (CAP recidivism, aging velocity, risk
   drift, audit-failure clustering), optionally narrates each via `completeJson`,
   and writes to `signals` (`/pk`). Timer triggers need `alwaysOn` (already set).
2. Endpoints — `GET /api/signals` (filter by program/category/severity),
   `PATCH /api/signals/:id` (ack/dismiss). `GET/PUT /api/signals/config`
   (thresholds) gated by `signal.manage`.
3. SPA — a Signals page: prioritized list, per-signal explanation, ack/dismiss,
   and a config panel for thresholds.
4. **Note:** start rules-based + AI-narrated; only add a trained model if the
   rules prove insufficient. Keep every signal explainable.

**Exit:** nightly job populates signals; analysts triage them; admins tune thresholds.

---

## Phase 6 — Admin & RBAC UI (`admin.manage`)

1. ✅ `users` CRUD + role/scope assignment UI — `GET/PUT /api/admin/users`, `userModel.js` validation, `scripts/provision-user.mjs` bootstrap, and the `/admin/users` SPA page (roles, `client.viewPii`, `clientScope`). *Remaining: custom roles, settings/feature flags, audit of admin actions (items 2–4).*
2. Custom roles in a `roles` container (cap-app pattern: `module` + `permissions[]`).
3. ✅ Settings doc (`appSettings`, id=`app`): feature flags (`assistant`, `c360`,
   `signals`, `draftedReports`) + idle timeout. `GET /api/settings` (all authed) /
   `PUT /api/admin/settings` (admin.manage), `settings.js` validation, the
   `/admin/settings` SPA page, and nav gated on flags via auth-context.
4. ✅ Admin/config audit log — `auditLog` container + `audit.writeAudit` wired
   into user provisioning + settings changes (actor / action / before-after /
   when); `GET /api/admin/audit` + the `/admin/audit` SPA tab. *Extend to report
   generation / signal config as those land.*

**Exit:** an admin can provision users, assign roles, and toggle features without a deploy.

---

## Cross-cutting / ops

- **Seeding** — a `scripts/seed-dev.mjs` that points `capData` at a local emulator
  `capapp` db (or copies a slice of prod cap data to dev) so reports show real shapes.
- **Cost** — Cosmos Serverless bills per RU; cache roll-ups, project queries, and
  watch AOAI token usage (logged to App Insights).
- **PHI** — never send raw client-level rows to AOAI; pass only aggregates. Keep
  the read-only boundary absolute (no write path to the cap account, ever).
- **Demo mode** — optional later: an `X-Data-Source` style toggle like the cap
  app, if a stakeholder demo DB is wanted.

---

## Suggested order of attack

Phase 1 → 2 → 3 deliver the most visible value fastest (reports, then summaries,
then the assistant). Phases 4–6 can be reprioritized against stakeholder demand.
Each phase is a reviewable PR; keep the skeleton's conventions and the app stays
coherent with the rest of the Beacon platform.
