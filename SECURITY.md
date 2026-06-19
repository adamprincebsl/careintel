# Beacon Care Intelligence — Security & PHI Safeguards Standard

We have a BAA covering Azure (Cosmos, Azure OpenAI, Functions), so handling PHI
is **permitted**. This document defines the **standard we build to anyway** so
PHI is safeguarded appropriately — mapped to the HIPAA Security Rule technical
safeguards (45 CFR §164.312) plus minimum-necessary and good practice. It states
what's **implemented**, what's a **gap**, and the **rule** going forward.

> **Governing rule:** any feature that reads, returns, or stores PHI must meet
> every "Standard" below or explicitly document an accepted exception. New
> PHI-touching endpoints reuse the shared seams (`authz.authorize`,
> `audit.logAccess`, de-identified views) — they don't roll their own.

---

## Data classification

| Class | Examples | Handling |
|---|---|---|
| **PHI** | client name, DOB, gender, free-text notes, narrative | Minimum-necessary; never stored in BCI Cosmos by default; initials only in-app; raw text only via the BAA-covered AI path; reduced to initials/aggregates everywhere else. |
| **Workforce (PII, not PHI)** | charting staff name/role | May be shown (accountability/quality); still access-controlled + audited. |
| **De-identified / aggregate** | initials, rollups with small-cell suppression, schema/dictionary | The default surface for reporting + non-PHI AI. |

---

## Controls — mapped to the standard

### Access control (§164.312(a))
- **Unique user identity** — Entra OID per user. ✅
- **Least-privilege RBAC** — dotted-string permissions; system + custom roles;
  sensitive perms (`client.viewDwLink`, `admin.manage`) granted only explicitly;
  default roles exclude client PHI. ✅ (`permissions.js`, `roles.js`, `authz.js`)
- **Two-axis authorization** — permission **×** location scope (`clientScope`,
  `clientInScope`); fail-closed when scope is absent. ✅
- **Automatic logoff** — `<SessionTimeout>` signs out after `idleTimeoutMinutes`
  (admin-set). ✅
- **Emergency/break-glass access** — not implemented. ⛳ *Gap — document a
  procedure if needed; default is none.*

### Audit controls (§164.312(b))
- **PHI access log** — every client lookup / DW link-follow writes to the durable
  `accessLog` (who / when / clientId / outcome), **never the name**. ✅
- **Fail-closed logging** — a granted PHI response is **not served** if the access
  can't be recorded (`logGrantedOrFail`). ✅
- **Config/admin audit** — user, role, and settings changes write to `auditLog`
  with before/after. ✅
- **Coverage rule** — *every* future PHI-touching path (AI assistant over PHI,
  note-scoring) MUST call `audit.logAccess` on the served path. ⛳ *Enforce as
  those features land.*
- **Log integrity/retention** — `accessLog`/`auditLog` are durable (no TTL);
  `aiTurns` 90-day. Delete is restricted to admins by RBAC. Immutable/WORM
  storage not configured. ⛳ *Gap — consider export to immutable store.*

### Integrity (§164.312(c))
- **Source is read-only** — BCI never writes to c360 (Viewer grant); our writes
  are de-identified aggregates only. ✅
- **Optimistic concurrency** — etag-guarded replace in the Cosmos repo. ✅

### Authentication (§164.312(d))
- **Entra ID** at the SWA edge; Functions verify the principal (fail-closed if
  absent); service-to-service via **managed identity** (no keys/secrets). ✅

### Transmission security (§164.312(e))
- **TLS everywhere** — HTTPS at the edge (HSTS), Cosmos + Fabric over TLS 1.2,
  `no-store` on PHI responses. ✅

### Encryption at rest
- Cosmos + Storage encrypt at rest by default (Microsoft-managed keys). ✅
- **Customer-managed keys (CMK)** — not configured. ⛳ *Gap — add if PHI is
  persisted at rest; needs a Key Vault key + Cosmos CMK config in Bicep.*

### Network
- Public endpoints with Entra/RBAC. **Private endpoints / VNet isolation** not
  configured. ⛳ *Gap — deploy-time hardening if required.*

---

## Minimum-necessary & de-identification
- App shows **initials only**; DOB/gender/full name not projected. ✅
- Reporting reads **de-identified views**; aggregates **suppress small cells**
  (`assertSafeColumns`, `suppressSmallCells`, default min 11). ✅
- Full identified record only via **approved, audited DW link-back** — never
  rendered or stored in BCI. ✅
- **Embeddings rule** — no vector built from raw PHI in BCI Cosmos (reconstructable
  = PHI); RAG indexes only non-PHI content. ✅ (design)

## AI / Azure OpenAI
- PHI to AOAI is **BAA-covered**. ✅
- Outputs persisted are **de-identified/aggregate**; raw notes + per-record AI
  text are not stored. ✅ (design)
- **AOAI human-review opt-out** for sensitive data — confirm the no-human-review
  / modified-abuse-monitoring path is enabled on the AOAI resource. ⛳ *Confirm
  at provisioning.*
- AI turns logged to `aiTurns` (90-day, purgeable). ✅

---

## Gap summary (hardening roadmap)
| Gap | When needed | Owner |
|---|---|---|
| CMK encryption on Cosmos | before persisting PHI at rest | infra/Bicep |
| Private endpoints / VNet | network-isolation requirement | infra/deploy |
| Immutable/WORM audit export | audit-integrity requirement | infra |
| AOAI human-review opt-out | before live PHI to AOAI | IT/Azure |
| Break-glass procedure | if emergency access required | security/ops |
| Audit coverage on AI/PHI paths | as C3 / note-scoring land | dev (use `logAccess`) |

These are **deliberate, tracked** items — the current build is PHI-minimal by
default, so none block today's reporting/initials features; they gate persisting
PHI at rest and the live AI-over-PHI work.
