# c360 → clean views: mapping methodology

How we turn raw c360 (`core-prod-db`) tables into **clean, de-identified,
AI-ready views**. One mapping doc per source table (this folder). Built from live
schema discovery; aggregate numbers confirmed from Azure (the sandbox's link to
the Fabric backend is intermittent).

## The two recurring patterns in c360

1. **UDO-coded columns.** Many columns are an `int` that references
   `dbo.s_UserDefinedOptions` (UDO = User Defined Options — a shared lookup keyed
   by `UDID`, grouped by `UDCategoryID`, labelled by `UDDescription`/`UDCode`).
   Most are **denormalized**: a column `X` (the int code) is paired with `X_`
   (the resolved text). So a clean view can use `X_` for the label and join UDO
   only where the `_` twin is missing (e.g. status codes).

2. **Identity columns = PHI.** Note tables carry `FirstName`, `LastName`,
   `ClientDOB`, `ClientGender`, and `*By_` user names. These never leave the DB
   identified — see de-id rules.

## The clean-view contract

Every source table gets up to two views:

- **`vw_<Entity>_Structured`** — **de-identified, UDO-resolved, structured fields
  only, NO free text.** Safe for reporting and for non-PHI AI. Identity reduced
  to **initials** (`UPPER(LEFT(FirstName,1))+'.'+UPPER(LEFT(LastName,1))+'.'`);
  DOB/gender/full names dropped; UDO codes resolved to labels; lifecycle/status
  derived into a clean enum.
- **`vw_<Entity>_NoteText`** *(only when there's narrative)* — the structured
  view **plus** the free-text column(s). This is PHI (free text can contain
  names/clinical detail) and is used **only** by the BAA-covered AI scoring
  pipeline, never by general reporting.

This is the "clean data views to AI" layer: the **Structured** view is what most
AI/reporting reads; the **NoteText** view is the controlled surface for narrative
scoring.

## De-identification rules (enforced in the view + downstream)

- **Never expose:** `FirstName`, `LastName`, `ClientDOB`, `ClientGender`, raw
  user names. Reduce to **initials** + program/location context.
- **`ClientID`** (surrogate) may stay in the view as a join key; what we send to
  AOAI or persist to Cosmos uses initials + program only (hash/drop `ClientID`).
- **Aggregates** persisted to Cosmos suppress small cells (< min N).
- **Free text** (`DetailedSummaryNote`, etc.) is PHI → only the NoteText view,
  only under the BAA, results aggregated, raw text never persisted.

## Where these views should live

Ideally the **data team creates these as `vw_*` views in c360** (so the security
boundary is theirs and BCI just reads them — our confirmed "query views, not base
tables" decision). The DDL in each mapping doc is ready to hand over. Until then,
the same SQL can run as a parameterized read from BCI with approval.

## Status of the note family

c360 has ~10 note tables (residential, behavior-support, nursing, day-hab,
waiver, enhanced-staffing, habilitation, behavior-analyst). We map them one at a
time; [residential-service-note.md](residential-service-note.md) is the first and
the template for the rest.
