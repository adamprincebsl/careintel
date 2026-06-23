# Incident Report — c360 mapping

The **initial incident report** is `BSL_Incident` (121 cols; the "Incident" form,
OpenForm 1476). It's a **consolidated** report — one row spans choking, fall, seizure,
behavior, injury, medical, abuse/neglect — discriminated by type. Unlike the residential
note, the **whole form tree is replicated** into c360 (38 tables).

Validated live (2026-06-23): **420 incidents**, `DateofIncident` Feb–Jun 2026.

## Reportable spine (resolved against live data)

| Concept | Source | Resolve via | Notes |
|---|---|---|---|
| Incident id | `BSL_Incident.BSL_IncidentID` | — | PK |
| Date / time | `DateofIncident`, `TimeofIncident` | — | datetime2 (UTC) |
| **Type(s)** | child `BSL_Incident_TypeofIncident.TypeofIncident` | UDO | **multi**: Behavior 252 · Accident/Medical 154 · Abuse/Neglect 16 · Death 3. (`BSL_Incident.TypeofIncident` int is **NULL on all rows** — do not use it.) |
| Type flags | `AbuseNeglect`, `AccidentMedicalIncident`, `BehaviorIncident` (bit) | — | mirror the type child |
| Severity | `Severity` (int) | UDO | Minor/Moderate/Serious/None; sparse (391/420 null) |
| Place of incident | `LocationofIncident` (int) | **UDO** | room/area (e.g. "Bathroom") — *not* `s_Locations` |
| Facility | `HomeFacility` (int) | `s_Locations` (verify) | the home/site |
| State | `State` (int) / facility `State` | — | for ET/CT + filters |
| Narrative (PHI) | `Descriptionof{what,where,when,why,how}happenedduringtheincident` | — | the 5 W's |
| 911 | `Was911called`, `Whocalled911`, `Instructionsgivenby911operator` | UDO/text | |
| Sub-type detail | `AbuseNeglectType`, `AccidentMedicalIncidentType`, `BehaviorIncidentType`, `InjuryType`, `MedVarianceType`, `RestraintType`… | UDO | per-domain |
| Vitals | `BloodPressure`, `Temperature`, `BloodSugar`, `HeartRate`, `Respirations` | — | captured inline |

## ⚠ Open: client linkage
`IndividualServedsName` (int, e.g. 6781) is **not** `c_Client.ClientID` and **not** a UDID
— it resolves to neither. The reportable spine doesn't need it, but the identified view +
de-identified initials + location-scope do. **To resolve:** the Core Incident form will
show what the "Individual Served's Name" control binds to (a contacts/person table or a
form-specific picklist). Until then the incident view shows the raw ref + flags it.

## Type / multi-select child tables (all replicated, link by `BSL_IncidentID`)
`_TypeofIncident`, `_AbuseNeglectType`, `_BehaviorIncidentType`, `_AdditionalBehaviorsAssociated`,
`_BehaviorInterventions`, `_AccidentMedicalIncidentType`, `_MedicalInterventions`,
`_InjuryLocationPrimaryAreaoftheBody`, `_InjuryLocationSpecificAreaoftheBody`, `_Outcome`,
`_SeizureDetails`, `_TreatmentProvidedBy` (each 3 cols: PK, `BSL_IncidentID`, the UDID).

## Follow-on sub-forms (separate workflow forms, by `BSL_IncidentID`)
Corrective Action Plan, Death Reporting, Fall, Medication Variance, SIB, Root Cause
Analysis (+committee/sources), Supervisor Follow-up (+Two, +notified), QA Follow-up,
Clinical Debrief, Witness/Investigation (+name lists), Audit Trail, Notification Log.

## View plan
- `vw_Incident_Structured` (de-identified): id, date, type(s) (STRING_AGG of the child),
  severity, place, facility, state, flags, vitals — **no narrative/client** → reporting.
- `vw_Incident_Identified` (PHI): + narrative (5 W's), sub-type detail, resolved client
  (once linkage solved), staff. Gated `note.viewPhi` + audit.
- Reporting cuts: **by type** (Behavior / Accident-Medical / Abuse-Neglect / Death),
  by severity, by place, by facility/state, by month; drill-in to sub-forms.
