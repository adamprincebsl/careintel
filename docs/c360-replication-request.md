# c360 replication request — Residential Service Note child tables

**Headline ask:** c360 already replicates the *child* tables for the **Behavior Support
Residential Note** (`BSLBR_BehaviorSupportResidentialNote_Interventions_BSP`) and the
**Incident** form (`BSL_Incident_BehaviorInterventions`, `BSL_Incident_MedicalInterventions`).
Please replicate the **Residential Service Note's** equivalents the same way — its ISP
interventions, BSP interventions, targeted-behavior occurrences, and ADL selections —
keyed by `BSL_ResidentialServiceNoteID`.

**Why:** the parent `BSL_ResidentialServiceNote` is in c360, but **none of its child rows
are** — so the goals/BSP/behavior responses and the ADL checklist that staff chart on
every note are invisible to reporting/AI.

**Scope note:** these were confirmed missing by querying **c360 only** — the BCI app
can't see the cx360 transactional source. The exact source table names must be traced by
the data team / Core Solutions from the form (they may not follow the `BSL_ResidentialServiceNote_*`
naming — the app-factory framework often names child tables generically).

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

| # | Purpose | Source table | Key columns (per the Core form) |
|---|---|---|---|
| 1 | **ISP** goal/objective/intervention responses (per shift) | *trace from form* (`hdnLoadedInterventions`) | NoteFK, GoalID, ObjectiveID, InterventionID, ResponseToService, SupportLevel, SupportPrompts, Comments |
| 2 | **BSP** objective responses (per shift) | *trace from form* (`hdnInterventionValuesBSP`) | NoteFK, ObjectiveID, ResponseToService, SupportLevel, SupportPrompts, Comments |
| 3 | **Targeted behavior** occurrences (per shift) | *trace from form* (`hdnTargetedBehaviorOccurrences`) | NoteFK, TargetBehaviorID, Intensity, Duration, StaffResponse, IndividualsResponse, NumberOfOccurrences, Comments |
| 4 | **ADLs addressed** (17-item multi-select) | *trace from form* (`cblActivitiesOfDailyLiving`) | NoteFK, ADL UDID/label |

*Source table names unknown from c360 (name search returns only the parent). The form's
hidden-field names above are the trace points; the data team / vendor maps each to its
persistence table, then replicates to c360 keyed by `BSL_ResidentialServiceNoteID`.*

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
