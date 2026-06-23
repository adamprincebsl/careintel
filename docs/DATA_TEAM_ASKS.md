# What Beacon Care Intelligence needs from the data team (and compliance / IT)

The app code for the c360 integration is built and tested; these are the
**external inputs** that turn the illustrative scaffolding into the real,
production feature. Grouped by what each one unblocks, roughly in priority order.

Connection (confirmed): Fabric warehouse `core-prod-db` @
`…-xdpozjn34hau3cztgs66ay2wlm.datawarehouse.fabric.microsoft.com`, same Fabric
workspace as `BSL_Silver_Warehouse`.

---

## A. To run any live c360 query from Azure  — **hard blocker**

1. **Grant the BCI managed identity read access to `core-prod-db`.** ⬅ **ONLY OPEN BLOCKER**

   `core-prod-db` is a **read-only Fabric SQL endpoint** (confirmed: `CREATE USER …
   FROM EXTERNAL PROVIDER` returns *"Msg 22424: CREATE USER is not a supported
   statement type"*), so access **must be granted in the Fabric portal — not via
   T-SQL.**

   **Forwardable request to the `core-prod-db` owner / data platform team:**
   > Please grant our app's managed identity **read** on the `core-prod-db` SQL
   > endpoint:
   > - **Identity:** `func-beacon-care-intelligence` — Entra **managed identity**,
   >   object id **`41529756-a1a2-4461-b376-62b43caa1ee5`**
   > - **How:** in the Fabric portal, **Share `core-prod-db`** (or ⋯ → Manage
   >   permissions → Add) and check **"Read all data using the SQL analytics
   >   endpoint"** (ReadData). *(Or add the identity as **Viewer** on the
   >   workspace — either works.)*
   > - **Prereq:** the tenant setting **"Service principals can use Fabric APIs"**
   >   must permit this identity (or add it to the allowed security group).
   > - **Why:** Beacon Care Intelligence reads c360 **read-only** for reporting/AI.

   - *Owner:* whoever administers `core-prod-db` / its Fabric workspace.
   - *Unblocks:* `/api/internal/c360-health`, the Explorer, all c360 reads. Until
     granted, the app's c360 queries fail (502 / "c360 unavailable").
   - *Verify:* portal Manage-permissions list shows the identity, **and** the
     app's Explore query returns rows (or `c360-health` → `{ok:true}`).

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

## C-bis. Residential Service Note — child data missing from c360  — **blocks ADL + ISP/BSP**

Validated against the source form (`ResidentialServiceNote.aspx`) vs. c360 for real
notes (74837, 77924). The flat `BSL_ResidentialServiceNote` table is in c360, but
the note's **child/related rows are not** — confirmed: **no table in c360 references
`BSL_ResidentialServiceNoteID`** (only the note itself), so the per-shift sub-records
never made it into the warehouse.

10. **ADL selections (the "Activities of Daily Living" checklist).**
    The form is a 17-item multi-select (UDIDs 89938–89954: Ambulation, Bathing,
    Dressing, Eating, Grooming, Laundry, Meal Prep, Med Admin, … Toileting,
    Transferring, Transportation). In c360 the only column is
    `BSL_ResidentialServiceNote.ActivitiesofDailyLiving` (**single `int`, NULL on all
    58,025 rows**) — i.e. the checklist is **not replicated at all**. Only the
    free-text `ResponsetoADL` is present.
    - **Ask:** expose the per-note ADL selections in c360 (the source child table, or
      a delimited/`_`-denormalized column on the note).
    - *Unblocks:* the "ADLs addressed" field in the note view.

11. **ISP Goals/Objectives/Interventions — per-shift responses.**
    The form pre-loads the client's ISP and staff chart, per shift, **Response**
    (Met/Partially/Not Met), **Support Level**, **# Support Prompts**, **Comments**
    against each Goal/Objective/Intervention. These responses are **not in c360**
    (no residential-note intervention child table). c360 has only the **plan
    definitions** (`UD_IAP_MSDP_AssessedNeeds_Goals` → `_Goals_Objectives` →
    `_Objectives_Interventions`).
    - **Ask:** expose the residential-note ISP response child table (the per-note grid:
      note id + Goal/Objective/Intervention id + Response + SupportLevel + Prompts + Comments).
    - **Confirmed by data:** `UD_IAP_MSDP_AssNeeds_Objectives_Interventions` is the **plan**
      (7,019 rows ≈ 5,703 distinct objectives — one row per plan intervention — with only
      **2** non-empty `Comments`). No c360 table references `BSL_ResidentialServiceNoteID`
      or carries the per-shift response text, so the per-note responses are genuinely
      absent from c360 (they live in the cx360 source sub-table, un-replicated).

12. **BSP Objectives + Targeted Behavior — per-shift responses.**
    Same story: plan definitions are in c360 (`BSLBO_BspObjectives`,
    `BSLTB_TargetBehavior` by `ClientID`); the per-shift responses/occurrences charted
    on the Residential Service Note are not. (Note: a child table exists for the
    *Behavior Support Residential Note* — `BSLBR_…_Interventions_BSP` — but that's a
    different note type.)
    - **Ask:** expose the residential-note BSP response + targeted-behavior-occurrence
      child tables.

    *Until 10–12 land,* the note view can show the **client's plan** (goals/objectives/
    interventions, BSP objectives, target behaviors) as context from the plan tables,
    but **not** what was charted on a specific shift.

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
| 10 | ADL selections into c360 | Data team | "ADLs addressed" field |
| 11 | ISP per-shift responses into c360 | Data team | ISP goals popout (per-shift) |
| 12 | BSP/target-behavior responses into c360 | Data team | BSP popout (per-shift) |

**Fastest unblock:** #1 (Viewer grant) + #5 (run the dump, review the dictionary)
get us to real de-identified reporting. #2 + #7 unblock the assistant.
