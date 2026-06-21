# c360 Requirements → Tables → Views register

The traceability spine for the data layer: each **reporting/AI requirement** maps
to its **source table(s)/columns**, the **transform/de-id**, and the **target
view**. Drives what views we build and in what order. Companion to the per-table
mapping docs in this folder.

**Conventions** (validated org-wide — see [residential-service-note.md](residential-service-note.md)):
- State = **Saved** (`SubmissionStatus` NULL) vs **Submitted** (set). No draft.
- **`IsAbsent = 1` ⇒ exclude** from completeness/participation metrics.
- Activity/option codes are category-relative → use the **`_` text columns**, not a UDID join.
- Client identity → **initials only**; charting staff (`CreatedBy`) may be shown.

Status legend: ✅ built (views-as-code) · 🟡 mapped, view pending · 🔎 needs discovery · ❓ needs requirement confirmation

---

## A. Mapped & built — Residential Service Note (`dbo.BSL_ResidentialServiceNote`)

| # | Requirement / question | Source columns | Transform / de-id | Target view | Status |
|---|---|---|---|---|---|
| R1 | Community services **offered vs participated**, by program / period | `CommunityActivitesOffered_`, `Library`/`Park`/`Walk`/… , `Program`, `ServiceDate`, `SubmissionStatus`, `IsAbsent` | submitted + non-absent; offered via `_` text; participated = any activity > 0 | `vw_ResidentialServiceNote_Structured` | ✅ |
| R2 | **Note completion** — Saved vs Submitted counts, by program / staff / period | `SubmissionStatus`, `Program`, `CreatedBy`, `ServiceDate` | `NoteState` enum | same | ✅ |
| R3 | **Who charted** / note volume by staff | `CreatedBy`(+`_`), `LastModifiedBy`(+`_`) | staff role via staff-table join | same (+ staff join) | 🟡 (needs staff table) |
| R4 | **Absence rate**, by program / period | `IsAbsent`, `Program`, `ServiceDate` | submitted notes | same | ✅ |
| R5 | **Service hours / time** (billing reconcile, in-ratio, carve-outs) | `Duration`, `ServiceStartTime/EndTime`, `InRatio`, `CarveOut*` | aggregate hours | (extend Structured) | ❓ confirm need |

## B. Mapped, view pending — other note types

| # | Requirement | Source table | Status |
|---|---|---|---|
| R6 | Day Hab service delivery / goals-addressed (offered/participated analog) | `dbo.BSL_ServiceNoteDayHabilitation` | 🔎 profile its columns first |
| R7 | Nursing note coverage / completion | `dbo.BSL_ServiceNoteNursing` | 🔎 |
| R8 | Waiver service note completion | `dbo.BSL_WaiverServiceNote` | 🔎 |
| R9 | Behavior-support note (interventions / target steps) | `dbo.BSLBR_BehaviorSupportResidentialNote` (+ `_Interventions_BSP`, `_TargetedNextStep`) | 🔎 |
| R10 | Enhanced staffing note | `dbo.BSL_EnhancedStaffingNote` | 🔎 |

## C. Cross-domain / candidate requirements — needs your input

| # | Requirement (business question) | Likely source | Status |
|---|---|---|---|
| R11 | Active **census** / attendance by program & date | client + program tables (find) | 🔎❓ |
| R12 | Note **timeliness** — submitted within N days of service | `ServiceDate` vs `CreatedOn`/submit time | ❓ confirm rule |
| R13 | Authorized service vs delivered (utilization) | `dbo.c_AuthorizedService` + note tables | 🔎❓ |
| R14 | Client roster / demographics (de-identified) | client master (find) | 🔎❓ |

---

## How we work each row
1. **Requirement** stated (the business question) — *your input for section C.*
2. **Discover** the source in **Explore** (you run it, or I give you the query) →
   columns, status field, the `_` label columns, `IsAbsent`.
3. **Map** columns → register row + the per-table mapping doc.
4. **Build** the de-identified view (`vw_*_Structured`, no free text) as a query
   function in `c360Views.js` (+ the `CREATE VIEW` DDL for the data team).
5. **Validate** counts in Explore; mark ✅.

## What I need from you to drive this
- **Confirm / prioritize** the requirements above (which matter most?).
- **Add the ones I can't know** — the actual reports/metrics leadership wants
  (section C is a guess). Even a rough list of "the 8–10 questions we need
  answered" turns this register into the real build plan.
