# Mapping: Day Habilitation Service Note  *(stub — pending live column pull)*

Source: **`dbo.BSL_ServiceNoteDayHabilitation`**. Confirmed to exist in c360;
its **column structure hasn't been pulled yet** (the sandbox→Fabric link was down
on the attempts). This stub records the **org-wide rules** (validated on the
residential note) that this note inherits, and what to confirm on the live pull.

## One-call analysis (run when the link is up / from Azure)
```
GET /api/c360/notes/profile?table=BSL_ServiceNoteDayHabilitation     # report.view
# or in code:
profileNote('BSL_ServiceNoteDayHabilitation')   // columns + volume + Saved/Submitted + absence
```

## Org-wide rules this note inherits (validated on residential)
- **Saved vs Submitted, no draft** — state from `SubmissionStatus` (NULL = Saved;
  set = Submitted, with UDO sub-labels). `IsDraft` not used.
- **Absent = section N/A** — `IsAbsent = 1` ⇒ the activity/goal section is
  legitimately blank; **exclude from completeness/participation metrics**
  (`AND ISNULL(IsAbsent,0)=0`).
- **UDO gotcha** — activity/option `int` codes are category-relative, NOT global
  `UDID` FKs. Use the denormalized `_` text columns; join UDID only for true
  status fields.
- **Client identity → initials** only in-app; full record via approved DW
  link-back. Charting staff via `CreatedBy` / `LastModifiedBy` (+ `_` names).

## To confirm on the live pull (then promote this stub to a full mapping)
- Full column list + row count + `ServiceDate` range.
- The **day-hab-specific attributes** — day hab tracks *goals / objectives /
  service outcomes* rather than residential community activities, so the
  "offered/participated" analog will differ (likely goal-addressed / progress
  fields). Identify the structured attribute columns + their `_` labels.
- `SubmissionStatus` value set (likely the same 1015/1016/1017 UDO domain).
- The free-text summary column (the AI-scoring target) for the NoteText view.

Once pulled, mirror [residential-service-note.md](residential-service-note.md):
column classification, the two views (`vw_DayHabServiceNote_Structured` /
`_NoteText`), and the metric queries — applying the rules above.
