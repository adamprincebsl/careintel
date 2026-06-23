# c360 replication request — Residential Service Note child tables

**Ask:** replicate the Residential Service Note's per-shift **child tables** from the
cx360 source into c360 (`core-prod-db`). The parent `BSL_ResidentialServiceNote` is
present, but none of its child rows are — so the goals/BSP/behavior responses and the
ADL checklist that staff chart on every note are invisible to reporting/AI.

## Evidence (run in c360)
```sql
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%ResidentialServiceNote%';
```
Returns **only** `BSL_ResidentialServiceNote.BSL_ResidentialServiceNoteID` — i.e. **no
child tables**. Also: `BSL_ResidentialServiceNote.ActivitiesofDailyLiving` is **NULL on
all 58,025 rows**, and `UD_IAP_MSDP_AssNeeds_Objectives_Interventions` is the **plan**
(7,019 rows ≈ 5,703 objectives, 2 non-empty Comments) — not per-shift responses.

## Tables needed (link each to `BSL_ResidentialServiceNoteID`)

| # | Purpose | Expected source table | Key columns (per the Core form) |
|---|---|---|---|
| 1 | **ISP** goal/objective/intervention responses (per shift) | `BSL_ResidentialServiceNote_Interventions` | NoteID, GoalID, ObjectiveID, InterventionID, ResponseToService, SupportLevel, SupportPrompts, Comments |
| 2 | **BSP** objective responses (per shift) | `BSL_ResidentialServiceNote_Interventions_BSP` | NoteID, ObjectiveID, ResponseToService, SupportLevel, SupportPrompts, Comments |
| 3 | **Targeted behavior** occurrences (per shift) | `BSL_ResidentialServiceNote_TargetBehavior` | NoteID, TargetBehaviorID, Intensity, Duration, StaffResponse, IndividualsResponse, NumberOfOccurrences, Comments |
| 4 | **ADLs addressed** (17-item multi-select) | `BSL_ResidentialServiceNote_ActivitiesOfDailyLiving` (or denormalize onto the note) | NoteID, ADL UDID/label |

*Table names are the expected Cx360 pattern (mirrors `BSLBR_BehaviorSupportResidentialNote_Interventions_BSP`, the one child that did replicate — for a different note type). Please confirm the exact source names.*

## To find the real source names (run in the cx360 source DB)
```sql
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%ResidentialServiceNote%'
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```
Any table besides the parent that has a `…ResidentialServiceNoteID` column is one we need.

## Likely broader
Other note types (Day Hab `BSL_ServiceNoteDayHabilitation`, Nursing `BSL_ServiceNoteNursing`,
Waiver `BSL_WaiverServiceNote`) probably have the same child-table gap — worth checking in
the same pass.

## Once replicated
The note view's **ADLs addressed** field and a per-shift **ISP/BSP responses** section
light up immediately (the app already shows the plan definitions via the care-plan popout;
these add what was actually charted on each shift).
