# What Beacon Care Intelligence needs from the data team (and compliance / IT)

The app code for the c360 integration is built and tested; these are the
**external inputs** that turn the illustrative scaffolding into the real,
production feature. Grouped by what each one unblocks, roughly in priority order.

Connection (confirmed): Fabric warehouse `core-prod-db` @
`…-xdpozjn34hau3cztgs66ay2wlm.datawarehouse.fabric.microsoft.com`, same Fabric
workspace as `BSL_Silver_Warehouse`.

---

## A. To run any live c360 query from Azure  — **hard blocker**

1. **Fabric workspace Viewer grant for the BCI managed identity.**
   After the app is deployed, its Function App (`func-beacon-care-intelligence`)
   gets a system-assigned managed identity. A Fabric **workspace owner** must add
   that identity as **Viewer** on the workspace containing `core-prod-db` (same
   procedure the cap app used — `beacon-capapp/docs/FABRIC_SETUP.md`).
   - *Owner:* Fabric workspace admin / data platform team.
   - *Unblocks:* `/api/internal/c360-health`, all rollups, client lookup. Until
     this is granted, every live query fails with "login failed."
   - *Note:* the cap app's MI grant does **not** extend to BCI — it's a separate
     identity needing its own grant.

---

## B. To handle PHI safely  — **hard blocker for AI + client features**

2. ~~**BAA coverage confirmation for Azure OpenAI.**~~ ✅ **Confirmed** — Beacon
   has a BAA covering Azure OpenAI. Raw c360 rows may be sent to AOAI under it.

3. **De-identification spec.**
   For each c360 table, which columns are **identifiers / PHI** vs **safe**, and:
   - the **minimum aggregation granularity** allowed (e.g. never report a group
     smaller than N clients), and the **small-cell suppression threshold**
     (we currently default to **11** — confirm or change).
   - *Owner:* Data team + Compliance (clinical input as needed).
   - *Unblocks:* the C2 aggregation guardrails (which refuse to aggregate on any
     non-"safe" column) and the de-identified rollups. This spec literally becomes
     the column classifications in the data dictionary.

4. **Minimum-necessary client fields for the detail page.**
   Confirm exactly which identifying fields the client-detail surface should
   return. We currently project **name + program/location + admission/discharge
   dates**, and deliberately **excluded DOB**. Add/remove per minimum-necessary.
   - *Owner:* Compliance + the people who'll use the page.
   - *Unblocks:* finalizing the live client projection (`clientLookup.js`).

---

## C. To make the AI accurate and useful  — shapes quality

5. **c360 schema / data-dictionary review.**
   We run `scripts/dump-c360-schema.mjs` to enumerate tables/columns; the data
   team then confirms, per table: the **grain** ("one row per…"), plain-language
   **descriptions**, the **join graph** between tables, a short **business
   glossary** (e.g. "active census", "length of stay"), and **metric
   definitions**. Captured in `docs/c360-annotations.example.json` → loaded as the
   versioned dictionary.
   - *Owner:* Data team (the people who know what the columns mean).
   - *Unblocks:* C1 (real dictionary) → C2 real rollups → C3 tool catalog.

6. **Medallion tier of `core-prod-db`.**
   Is it raw, or a curated/cleansed layer? Affects which columns we trust and how
   we de-identify.
   - *Owner:* Data team.

7. **Top ~10 questions** users would actually ask of c360.
   This shapes the assistant's tool catalog (C3) more than any other single input
   — worth a 30-minute working session.
   - *Owner:* The eventual users (care ops / leadership) + data team.

---

## D. Compliance confirmations  — needed before go-live with real data

8. **Audit-log retention alignment.**
   Confirm our defaults fit Beacon's PHI policy: `accessLog` (who viewed which
   client) is **durable**; `aiTurns` (AI transcripts, which can echo PHI) defaults
   to **90 days, admin-purgeable**. Adjust if policy differs.
   - *Owner:* Compliance.

9. **Embedding-model availability + quota** (only for the later RAG phase, C4).
   Confirm an Azure OpenAI embedding deployment (e.g. `text-embedding-3-small`)
   is available in-region with quota.
   - *Owner:* IT / Azure admin.

---

## Quick reference — who we need, for what

| # | Ask | Owner | Blocks |
|---|---|---|---|
| 1 | Fabric Viewer grant for BCI MI | Fabric/data platform | any live query |
| 2 | BAA covers Azure OpenAI | Compliance | AI over raw PHI |
| 3 | De-id spec + min-cell threshold | Data + Compliance | real rollups, guardrails |
| 4 | Minimum-necessary client fields | Compliance + users | client detail projection |
| 5 | Schema / dictionary review | Data team | C1→C2→C3 |
| 6 | Medallion tier of core-prod-db | Data team | de-id correctness |
| 7 | Top ~10 questions | Users + data | assistant tool catalog |
| 8 | Retention alignment | Compliance | go-live |
| 9 | Embedding model quota | IT / Azure | RAG phase (C4) |

**Fastest unblock:** #1 (Viewer grant) + #5 (run the dump, review the dictionary)
get us to real de-identified reporting. #2 + #7 unblock the assistant.
