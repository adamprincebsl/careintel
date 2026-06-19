# Mapping: BSL Residential Service (Shift) Note

Source: **`dbo.BSL_ResidentialServiceNote`** (93 columns) — the residential
shift note. Status & lookup values map to **`dbo.s_UserDefinedOptions`** (UDO).
**Validated against live data (58,025 rows).**

> ⚠️ **UDO gotcha (validated):** not every `int` column is a global `UDID` FK.
> **Status fields** (`SubmissionStatus`) carry real UDIDs (1015 Submitted / 1016
> Feedback / 1017 Approved) and join `= UDO.UDID` correctly. But **activity/option
> fields** (`CommunityActivitesOffered`, `Library`, `Park`, …) are **category-
> relative small codes (1,2,3)** — joining them to `UDO.UDID` returns the WRONG
> label (e.g. `CommunityActivitesOffered=2` → "Completed" by UDID, but actually
> means **"Not Offered"**). **Use the denormalized `_` text columns** for these,
> or join with the correct `UDCategoryID`. The clean view below does this.

---

## 1. Column groups (the 93 columns, classified)

| Group | Columns | Notes |
|---|---|---|
| **Client identity (PHI — drop/reduce)** | `FirstName`, `LastName`, `ClientDOB`, `ClientGender` | Reduce to **initials**; drop DOB/gender/names. |
| **Authorship / charting staff** | `CreatedBy`(int FK→staff), `CreatedBy_`(name), `CreatedOn`, `LastModifiedBy`(int FK→staff), `LastModifiedBy_`(name), `LastModifiedOn` | **Who charted the note.** Staff are workforce data (not client PHI) — fine to surface for accountability/quality. |
| **Keys / linkage** | `BSL_ResidentialServiceNoteID` (PK), `ClientID`, `CompanyID`, `EncounterID` | `ClientID` is the surrogate join key. |
| **Service context** | `ServiceName`(int), `Location`(int), `Program`(int), `ServiceDate`, `ServiceStartTime/EndTime`, `Duration`, `InRatio`, carve-out fields | int's resolve via UDO. |
| **Lifecycle / status** | `SubmissionStatus`(int→UDO — **the state**), `IsAbsent`(bit — section N/A), `ProcessedStatus`/`ProcessedDate` (billing). *Unused: `IsDraft`, `RecordStatus`.* | **Saved vs Submitted** = SubmissionStatus NULL vs set. |
| **Community services — offered** | `CommunityActivitesOffered`(int→UDO) + `CommunityActivitesOffered_`(text) | The "offered" flag. |
| **Community services — participation** | `Library`, `Park`, `Shopping`, `SpecialEvent`, `SportsExercise`, `Walk`, `WorshipService`, `Other` (all int→UDO) + each `*Prompts`(int) + `*Prompts_`(text) | Which activities + prompt level. |
| **In-home activities** | `InHomeActivities`(int)+`_`, `Games`, `Movie`, `CookingBaking`, `OutdoorActivities`, `OtherInHomeActivity`(+detail) | |
| **ADLs / appointments** | `ActivitiesofDailyLiving`(int), `ResponsetoADL`(text), `Appointment`(int), `AppointmentResponse`(text) | |
| **Free text (PHI — NoteText view only)** | `DetailedSummaryNote`, `CommunityActivities`, `*Details`, `OtherCarveReasonDetail*` | **The AI-scoring target.** |
| **Survey** | `IndividualSurveyResponse`(int) | |

> The `int` + `_text` pairing (e.g. `CommunityActivitesOffered` / `…Offered_`)
> is the UDO denormalization — the `_` column already holds the resolved label.

---

## 2. Saved vs submitted — VALIDATED + domain rule

**There is no "draft" feature.** A note is either **Saved** or **Submitted**,
keyed off **`SubmissionStatus`** (a real UDID FK) — never `IsDraft`:

| SubmissionStatus | Label (UDO) | Count | NoteState |
|---|---|---|---|
| `NULL` | *(none)* | 42,579 | **Saved** |
| `1015` | Submitted | 14,844 | Submitted |
| `1017` | Approved | 574 | Submitted (approved) |
| `1016` | Feedback | 28 | Submitted (sent back) |

- Clean `NoteState = CASE WHEN SubmissionStatus IS NULL THEN 'Saved' ELSE 'Submitted' END`;
  keep `SubmissionStatusLabel` for the Submitted/Approved/Feedback detail.
- **`IsDraft` not used** (feature off — 3 true / 19,989 false / 38,033 NULL).
- **`RecordStatus` ≈ 1 for all rows** — not a useful lifecycle field.

## 2a. Absent notes — domain rule

**`IsAbsent = 1`** ⇒ the client was absent, so the activity / community-services
section below is **legitimately blank**. Such notes must be **excluded** from
completeness, offered, and participated metrics (or reported separately) — else
absent notes look falsely incomplete (and they explain many of the NULLs). All
metric queries add `AND ISNULL(IsAbsent, 0) = 0`; the view surfaces `IsAbsent`.

---

## 3. Who charted the note (staff linkage)

- **Charted by** = **`CreatedBy`** (the staff who created the note);
  **last editor** = `LastModifiedBy`. Both are `int` FKs to the **staff table**.
- The note **already denormalizes the names**: `CreatedBy_` and `LastModifiedBy_`
  — so charter name is available with **no join**.
- **Join for richer staff attributes** (role/title/discipline/active/email):
  `CreatedBy = <staffTable>.<staffId>`. The staff table couldn't be enumerated on
  this pass (link down); it's an `s_`-prefixed user/staff table (like
  `s_UserDefinedOptions`) — confirm the exact name + key from Azure (candidates:
  `s_User` / `s_Staff` / `Staff` / `Employee`). Once confirmed, the views below
  resolve `CreatedByRole` etc. from it.
- Staff identity is **workforce data, not client PHI**, so surfacing the charter
  (name/role) is appropriate — and it's what powers "note completeness by staff,"
  "unsubmitted drafts by author," and accountability reporting.

## 4. "How many had community services offered / how many participated?"

Already structured — answerable with plain SQL, **no AI, no PHI in the output**.
**Validated** label values: `CommunityActivitesOffered_` ∈ {`Offered` (3,763),
`Not Offered` (15,002), `NULL` (39,260)}.

```sql
-- Offered vs participated, SUBMITTED + NON-ABSENT notes.
SELECT
  COUNT(*)                                                       AS submitted_present,
  SUM(CASE WHEN n.CommunityActivitesOffered_ = 'Offered'     THEN 1 ELSE 0 END) AS offered,
  SUM(CASE WHEN n.CommunityActivitesOffered_ = 'Not Offered' THEN 1 ELSE 0 END) AS not_offered,
  SUM(CASE WHEN (ISNULL(n.Library,0)+ISNULL(n.Park,0)+ISNULL(n.Shopping,0)
        +ISNULL(n.SpecialEvent,0)+ISNULL(n.SportsExercise,0)+ISNULL(n.Walk,0)
        +ISNULL(n.WorshipService,0)+ISNULL(n.[Other],0)) > 0 THEN 1 ELSE 0 END) AS participated_any
FROM dbo.BSL_ResidentialServiceNote n
WHERE n.SubmissionStatus IS NOT NULL          -- submitted
  AND ISNULL(n.IsAbsent, 0) = 0;              -- exclude absent (section N/A)
```

*Implemented as `c360Views.profileResidentialNotes()`. Exact submitted cross-tab
numbers pending one clean run (link was intermittent); structure is confirmed.*

**Where AI adds value** (beyond the structured fields): reading
`DetailedSummaryNote` to (a) extract attributes not captured in structured
columns, (b) **validate** that the narrative agrees with the structured flags
(e.g. note says "went to the park" but `Park` is blank → data-quality signal),
and (c) score note **quality/completeness**. See §6.

---

## 5. Clean view — `vw_ResidentialServiceNote_Structured` (de-identified, no free text)

Hand this to the data team to create in c360, or read the same SQL with approval.
Replace `s_Staff`/`StaffId`/`StaffName`/`Title` with the confirmed staff table +
columns (see §3).

```sql
CREATE VIEW dbo.vw_ResidentialServiceNote_Structured AS
SELECT
  n.BSL_ResidentialServiceNoteID                         AS NoteId,
  n.ClientID                                             AS ClientId,
  UPPER(LEFT(LTRIM(n.FirstName),1)) + '.'
    + UPPER(LEFT(LTRIM(n.LastName),1)) + '.'             AS ClientInitials,
  n.Program, n.Location, n.ServiceName,
  n.ServiceDate, n.Duration, n.InRatio,
  -- authorship / charting staff (workforce data, not client PHI)
  n.CreatedBy        AS ChartedByStaffId,
  n.CreatedBy_       AS ChartedByName,
  cs.Title           AS ChartedByRole,      -- from the staff-table join
  n.CreatedOn        AS ChartedOn,
  n.LastModifiedBy_  AS LastModifiedByName,
  n.LastModifiedOn,
  -- lifecycle (validated): state from SubmissionStatus; IsDraft/RecordStatus unused
  n.SubmissionStatus, ss.UDDescription                   AS SubmissionStatusLabel,
  CASE WHEN n.SubmissionStatus IS NULL THEN 'Saved' ELSE 'Submitted' END AS NoteState,
  n.IsAbsent,   -- 1 = client absent; activity section legitimately blank
  -- community services: use the denormalized `_` text (NOT a UDID join)
  n.CommunityActivitesOffered_                           AS CommunityServicesOffered,  -- 'Offered'/'Not Offered'
  n.Library, n.Park, n.Shopping, n.SpecialEvent,
  n.SportsExercise, n.Walk, n.WorshipService, n.[Other],
  n.Appointment, n.ActivitiesofDailyLiving, n.InHomeActivities
  -- DetailedSummaryNote and other free text intentionally EXCLUDED
FROM dbo.BSL_ResidentialServiceNote n
LEFT JOIN dbo.s_UserDefinedOptions ss ON n.SubmissionStatus = ss.UDID  -- valid: real UDID FK
LEFT JOIN dbo.s_Staff             cs ON n.CreatedBy        = cs.StaffId;  -- confirm staff table/cols
```

## 6. PHI view — `vw_ResidentialServiceNote_NoteText` (scoring only)

```sql
CREATE VIEW dbo.vw_ResidentialServiceNote_NoteText AS
SELECT s.*, n.DetailedSummaryNote
FROM dbo.vw_ResidentialServiceNote_Structured s
JOIN dbo.BSL_ResidentialServiceNote n ON n.BSL_ResidentialServiceNoteID = s.NoteId;
```

Used **only** by the AI scoring pipeline, under the BAA. Never read by reporting;
never persisted raw.

---

## 7. AI note-scoring pipeline (sample → score → aggregate)

1. **Sample** N submitted notes from `vw_…_NoteText` (live, under BAA).
2. **Score each** via AOAI `completeJson` with a fixed schema, e.g.:
   `{ communityServiceOffered: bool, communityServiceParticipated: bool,
      activities: string[], adlsAddressed: bool, appointmentMentioned: bool,
      completenessScore: 1–5, qualityFlags: string[] }`.
3. **Validate** AI extraction vs the structured fields (agreement / disagreement
   per attribute) → a data-quality signal.
4. **Aggregate** to PHI-free results and persist to Cosmos `insights`/`signals`:
   e.g. "of N submitted notes, X% recorded community service offered, Y%
   participated; Z% narrative/structured disagreement on participation; mean
   completeness 3.8/5." **Raw notes and AI per-note text are never persisted.**
5. Surfaced as an insight card / signal; sampling + token use logged to `aiTurns`.

This is the "use AI to score a sample of note summaries, parse the attributes,
and summarize" capability — bounded, BAA-covered, de-identified output.

---

## Validated facts (live, 58,025 rows)

- Volume **58,025**; `SubmissionStatus`: NULL 42,579 / Submitted(1015) 14,844 /
  Approved(1017) 574 / Feedback(1016) 28.
- `CommunityActivitesOffered_`: Offered 3,763 / Not Offered 15,002 / NULL 39,260.
- `IsDraft` mostly NULL (use SubmissionStatus). `RecordStatus` ≈ 1 for all.
- Activity codes are **category-relative** — resolve via `_` text, not UDID.
- Data quality: ServiceDate range 1967→2027; only **2** pre-2018, **6** future
  (negligible bad rows — filterable).

## Still open

- **Staff table** name + key (`CreatedBy`/`LastModifiedBy` FK target) — link was
  down when enumerating; resolve `ChartedByRole`.
- The exact **UDCategoryID + join key** to resolve code-only activity fields that
  lack a `_` twin (most have the twin, so low priority).
- One clean **submitted offered/participated cross-tab** run for exact numbers.
- **Staff table** name + key column that `CreatedBy` / `LastModifiedBy` reference
  (likely `s_*`), and which staff attributes to expose (Title/Role, discipline,
  active, email) for the `ChartedByRole` join.
