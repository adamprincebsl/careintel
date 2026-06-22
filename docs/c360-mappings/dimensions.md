# c360 dimension join graph

The shared dimensions every note/domain view joins to. Derived from the schema
snapshot (`c360-schema.json`, 171 tables). This is the spine of the data layer —
location hierarchy, client, staff, and the UDO lookup.

## Location hierarchy → State / Location / Program names
Note tables carry `Location` (int) and `Program` (int) ids. Resolve:

```
note.Location  → s_Locations.LocationID
                   → LocationName, State (varchar, e.g. 'MI'), City, Region, Area
note.Program   → s_Program.ProgramID
                   → Program (name), ProgramCode, Abbreviation, ProgramTypeID
                       → s_ProgramType.ProgramType (name)
UD_LocationHierarchy.Location → Region/State/Market/Area/District/Entity (the org rollup)
```

- **`s_Locations`** is the richest: `LocationName` + **`State`** (varchar) + City + Region/Area. This is what powers the **State → Location** filters and friendly names.
- **`s_Program`** → program name + `ProgramTypeID` → `s_ProgramType` for program type (Residential / Day Hab / etc.).
- **`UD_LocationHierarchy`** gives the corporate rollup (Region/Market/Area) keyed by `Location` — use for org-level reporting.

## Client → `c_Client` (PHI-DENSE — 268 cols)
```
note.ClientID → c_Client.ClientID
```
Identifiers present (HIPAA): `FirstName`, `LastName`, `MiddleName`, `BirthDate`/`DOB`,
**`SocialSecurityNumber`**, `MedicaidID`/`MedicareNumber`, `Address*`, phones, `EmailAddress`.
- **De-identified client view** must expose ONLY: `ClientID` (surrogate) + **initials** + program/location. Everything above is identified-view-only (`note.viewPhi`-class gating).
- **Enrollment / census:** `c_ClientProgram` (`ClientID`, `ProgramID`, `LocationID`, `IsActive`, `StartDate`/`EndDate`, `AdmitDate`, `DischargeTime`) → the basis for **active census** and "expected vs documented" baselines.

## Staff → `s_User`
```
note.CreatedBy / LastModifiedBy (int) → s_User.UserID
                                          → FirstName, LastName, JobTitle (role), EmailAddress
```
- Note already denormalizes the name (`CreatedBy_`); join `s_User` for **role/JobTitle** and active status.
- Staff = workforce PII (showable for accountability), not client PHI.

## Lookups → UDO
```
<column> (int) → s_UserDefinedOptions.UDID → UDDescription           (when it's a true UDID FK, e.g. SubmissionStatus)
s_UserDefinedOptions.UDCategoryID → s_UserDefinedCategories.UDCategory  (the option group)
```
- **Caveat (validated):** activity/option codes are **category-relative**, not global UDIDs — use the denormalized `_` text columns, or join on `UDCategoryID` + value. `s_UserDefinedCategories` names the categories.

## Implication for every domain view
Each `vw_<domain>_Structured` LEFT JOINs:
`s_Locations` (LocationName, State), `s_Program`+`s_ProgramType` (program name/type),
`s_User` (charting-staff role), and resolves UDO via `_` columns / UDID. The
`_Identified` variant adds `c_Client` PHI. This makes **State/Location/Program/Client
cascading filters + friendly names** work uniformly — the thing we were missing.
