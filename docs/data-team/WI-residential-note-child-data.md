# Work Item — Replicate residential-note child data to c360 (ADLs, Goals/ISP)

**Type:** Product Backlog Item / Data Engineering
**Area:** c360 Fabric warehouse (`core-prod-db`)
**Priority:** High
**Requested by:** Beacon Care Intelligence (BCI)
**Date:** 2026-07-07

## Summary
The residential service note's **per-note child records** are not available in
c360. The parent note (`BSL_ResidentialServiceNote`) and the ISP **plan** tables
are replicated, but the tables that record **what was documented on each note**
(daily-living activities checked, and goals/objectives/interventions addressed
with their response + support level) are either missing or empty. This blocks
the BCI note view from showing "ADLs addressed" and "Goals/ISP documented."

## Gaps (please replicate to c360 `dbo`)

| # | Data | Source table | State in c360 |
|---|------|--------------|---------------|
| 1 | **Per-note goals/objectives/interventions + response** | `BSL_ResidentialServiceNote_Interventions` | **Missing** (table not present) |
| 2 | **ADL checkboxes / responses per note** | `UD_DailyLivingActivities` (and any per-note ADL link table) | **Present but 0 rows** (not populated) |

### 1. `BSL_ResidentialServiceNote_Interventions` (the note's goal grid)
Links a note to the ISP goal/objective/intervention it addressed. Confirmed
source columns (from the source-system query):
- `BSL_ResidentialServiceNoteID` (FK → `BSL_ResidentialServiceNote`)
- `GoalID` → `UD_IAP_MSDP_AssessedNeeds_Goals` *(already in c360, 3,553 rows)*
- `ObjectiveID` → `UD_IAP_MSDP_AssNeeds_Goals_Objectives` *(in c360, 6,031 rows)*
- `InterventionID` → `UD_IAP_MSDP_AssNeeds_Objectives_Interventions` *(in c360, 6,854 rows)*
- `ResponseToService` (1=Met, 2=Partially Met, 3=Not Met, 4=N/A)
- `SupportLevel` (1=Independent, 2=Verbal Prompt, 3=Physical Assist, 4=Full Support)
- `SupportPrompts` (int), `Comments` (text)

> The three `UD_IAP_MSDP_*` plan tables are already replicated, so only the
> **linking/response table** is needed to join notes → goals.

### 2. ADL data per note (`UD_DailyLivingActivities`)
The table exists in c360 but has **0 rows** — the pipeline isn't loading it.
Please populate it (and confirm the key that ties an ADL row to a note/client/
date). On the note, `ActivitiesofDailyLiving` (int) and `ResponsetoADL` (text)
are present but do not capture which individual ADLs were checked.

## Acceptance criteria
- [ ] `BSL_ResidentialServiceNote_Interventions` present in c360 `dbo`, joinable to
      `BSL_ResidentialServiceNote` by `BSL_ResidentialServiceNoteID`, with the
      columns above.
- [ ] `UD_DailyLivingActivities` populated, with a documented key to note/client/date.
- [ ] Refresh cadence matches `BSL_ResidentialServiceNote` (same pipeline/schedule).
- [ ] Row counts sanity-checked against the source for a sample month.

## Why it matters (unblocks in BCI)
- **Note view → Goals/ISP documented**: show goal, objective, intervention,
  response (Met/Partially/Not), support level, comments per shift.
- **Note view → ADLs addressed**: show which ADLs were checked and the response.
- **Documentation compliance**: measure goal/ADL completion, not just note completion.

## Reference (source-system query)
See the residential-note grid query provided by BCI (goals/objectives/
interventions joined via `BSL_ResidentialServiceNote_Interventions`). Available
on request.
