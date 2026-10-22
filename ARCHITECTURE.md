# Xzare Business Software Suite — Architecture

> Status: living document. Revision 1 (initial architecture).
> Scope: the shared **Xzare Business Engine** plus thirty distinct products composed from shared engines.
> Product workflows and editions: [PRODUCT_PORTFOLIO.md](./docs/PRODUCT_PORTFOLIO.md).
> Current additions: portable `@xzare/barcode`; [implementation and boundaries](./docs/BARCODE_ENGINE.md).

---

## 1. Current Project Assessment

The repository was empty at the start of this work: no source, no git history, no build
configuration. Everything described here is greenfield, which means there is no legacy code to
preserve and no migration burden — but also no existing decisions to inherit, so every choice below
is made explicitly and recorded.

Verified environment on the development machine:

| Tool     | Version          | Note                                                           |
| -------- | ---------------- | -------------------------------------------------------------- |
| Node.js  | 22.23.1          | Satisfies Electron 3x toolchain requirements                   |
| npm      | 10.9.8           | Available, not used as the primary PM                          |
| pnpm     | 10.12.1          | **Chosen** package manager (workspaces, strict node_modules)   |
| git      | 2.55.0.windows.2 | Available                                                      |
| Python   | 3.14.6           | Present; relevant only if a native module needs a source build |
| .NET SDK | absent           | Rules out WPF/WinUI/MAUI without an extra install              |

Target OS is 64-bit Windows 10/11, consistent with the Egyptian small-business market where
Windows desktops and thermal printers dominate.

---

## 2. Recommended Technology Stack

| Concern         | Choice                                                       | Rationale                                                                                                                                                    |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell           | **Electron** (latest stable)                                 | Mature Windows packaging, printing, filesystem and USB/serial access; composable engines support thirty products; broad hiring pool in Egypt for web skills. |
| Language        | **TypeScript** (strict)                                      | Type safety across domain, data and UI; a single language for the whole suite lowers maintenance cost.                                                       |
| Renderer UI     | **React 19 + Vite**                                          | Fast HMR, predictable rendering, excellent RTL-capable component ecosystem.                                                                                  |
| Build (desktop) | **electron-vite**                                            | Handles main/preload/renderer bundling, native-module externals and the ESM/CJS boundary correctly.                                                          |
| Styling         | **Tailwind CSS v4** + bespoke design system                  | Logical properties (`ms-`/`me-`/`ps-`) make Arabic RTL first-class rather than a patch.                                                                      |
| Client data     | **TanStack Query** (server state) + **Zustand** (UI state)   | Clear separation between cached IPC results and ephemeral UI state.                                                                                          |
| Database        | **SQLite** via **better-sqlite3**                            | Embedded, zero-admin, transactional, battle-tested; synchronous API makes correct atomic transactions straightforward.                                       |
| Data access     | Hand-written typed repositories over better-sqlite3          | Full control over SQL, indexes and transaction boundaries; no async interleaving hazard (see §19).                                                           |
| Validation      | **Zod**                                                      | One schema per IPC channel, reused for form validation.                                                                                                      |
| Testing         | **Vitest** (unit/integration), **Playwright** (Electron E2E) | Fast feedback on domain logic, real-window coverage for critical flows.                                                                                      |
| Packaging       | **electron-builder** (NSIS)                                  | Professional Windows installer, per-machine or per-user install, clean uninstall.                                                                            |
| Updates         | **electron-updater**, opt-in                                 | Perpetual-licence friendly: updates are offered, never forced.                                                                                               |
| Monorepo        | **pnpm workspaces** + TypeScript project references          | Lightweight; no extra build orchestrator until the product count justifies one.                                                                              |

### Rejected alternatives

- **.NET WPF / WinUI** — technically excellent for Windows desktop, but no SDK is installed and it
  constrains the suite to a smaller local hiring pool. Reconsider only if native Windows integration
  becomes the dominant requirement.
- **Tauri** — smaller binaries and lower memory use, but thermal-printer, label-printer and
  peripheral integration is far less proven, and the Rust surface raises the maintenance bar for a
  team shipping the shared engines and thirty distinct workflows.
- **Kysely / Drizzle ORM** — appealing type-safety, but their async-first transaction APIs around a
  synchronous SQLite driver invite interleaved transactions. Money-handling code must not carry that
  risk; see §19.
- **PostgreSQL / MySQL** — contradicts the "no server, no admin, offline-first" requirement for a
  single-PC shop.

---

## 3. Architectural Overview

Three OS processes, with a hard security boundary between them.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Renderer process  (sandboxed, no Node.js, no direct DB access)       │
│   React UI · design system · i18n/RTL · TanStack Query · Zustand     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ window.xzare.*  (typed, allow-listed)
┌───────────────────────────────┴──────────────────────────────────────┐
│ Preload  (contextIsolated bridge — the ONLY renderer↔main channel)   │
│   exposes a fixed channel list; forwards nothing else                │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ ipcMain.handle + Zod validation
┌───────────────────────────────┴──────────────────────────────────────┐
│ Main process  (trusted)                                              │
│   IPC routers → Application Services → Domain → Repositories         │
│   SQLite (better-sqlite3) · licensing · backup · printing · logging  │
└──────────────────────────────────────────────────────────────────────┘
```

### Layers

1. **Presentation** (`packages/ui`, `apps/*/src/renderer`) — React components and screens. Contains
   no business rules; every mutation goes through IPC.
2. **Application** (`packages/engine/src/services`) — use-case orchestration: permission check →
   validation → transaction → domain calls → audit entry → result. The only layer that opens
   transactions.
3. **Domain** (`packages/domain`) — pure functions and entities: invoice totalling, discount rules,
   stock-movement maths, commission calculation, recipe explosion. No I/O, no SQL, no Electron.
   Trivially unit-testable.
4. **Infrastructure** (`packages/db`, `packages/engine/src/infra`) — SQLite connection, migrator,
   repositories, filesystem, printing, crypto.
5. **Database** (`packages/db/migrations`) — forward-only, numbered SQL migrations.
6. **Integration** (`packages/engine/src/integrations`) — printers, barcode scanners, label
   printers, optional update server, optional activation server.
7. **Shared Core** (`packages/core`) — Money, Quantity, Result, errors, ULIDs, clock, logger.
8. **Product Modules** (`apps/pos`, `apps/restaurant`, …) — compose engine modules and add
   product-specific domain logic and screens.

**Dependency rule, enforced by review and by TypeScript project references:**

```
core   ← domain   ← engine   ← apps
core   ← db       ← engine
core   ← ipc      ← engine, apps
core   ← i18n, ui ← apps
core   ← barcode ← engine, apps
```

`domain` depends on `core` only. It never imports `db`, `engine`, Electron or React. This is the
single most important structural rule in the codebase: it keeps all business rules testable without
a database or a window.

Barcode recognition runs at application ingress before invoking the pure domain rules; it does not
add a dependency from `domain` to `barcode`.

---

## 4. Folder Structure

```
Xzare-POS/
├─ ARCHITECTURE.md
├─ IMPLEMENTATION_PLAN.md
├─ package.json                 # workspace root, shared scripts
├─ pnpm-workspace.yaml
├─ tsconfig.base.json           # strict compiler settings
├─ vitest.config.ts             # workspace-wide test config + src aliases
│
├─ packages/
│  ├─ core/                     # Money, Quantity, Result, errors, ULID, clock, logger
│  ├─ db/                       # connection, pragmas, migrator, UoW, integrity, sequences
│  │  └─ src/migrations/        # 001_core_schema.ts, 002_…
│  ├─ domain/                   # pure business rules per bounded context
│  ├─ engine/                   # application services, repositories, IPC routers
│  │  ├─ src/services/          # auth, users, customers, products, sales, …
│  │  ├─ src/repositories/
│  │  ├─ src/licensing/
│  │  ├─ src/backup/
│  │  ├─ src/printing/
│  │  └─ src/audit/
│  ├─ ipc/                      # channel names + Zod contracts (shared by main & renderer)
│  ├─ i18n/                     # ar/en dictionaries, direction, formatters
│  └─ ui/                       # design system: Button, DataTable, MoneyInput, …
│
├─ apps/
│  ├─ pos/                      # Xzare POS (first product)
│  │  ├─ electron.vite.config.ts
│  │  ├─ src/main/              # bootstrap, window, IPC registration
│  │  ├─ src/preload/           # contextBridge surface
│  │  └─ src/renderer/          # screens, routes
│  ├─ restaurant/  fashion/  mobile-store/  auto-workshop/
│  ├─ clinic/  gym/  salon/  inventory-accounting/  contracting/
│  └─ (added per phase — not scaffolded until their phase begins)
│
└─ tools/
   ├─ licence-gen/              # vendor-side licence signing CLI (private key never shipped)
   └─ seed/                     # realistic large-dataset generator for performance tests
```

---

## 5. Database Design

SQLite with `foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout=5000`,
`synchronous=FULL` (durability is worth more than throughput for a POS).

### Conventions

- **Primary keys**: `TEXT` **ULID** — lexicographically sortable (good index locality), generated
  without a round-trip, and collision-free across future branch/device sync.
- **Money**: `INTEGER` **piastres** (1 EGP = 100 piastres). Never `REAL`. See §19.
- **Quantity**: `INTEGER` **milli-units** (3 decimal places) — enough for grams and litres.
- **Rates** (tax, commission, discount %): `INTEGER` **basis points** (1% = 100 bp).
- **Timestamps**: `INTEGER` Unix milliseconds, UTC. Formatting is a presentation concern.
- **Soft delete**: business entities use `is_active` / `voided_at`. Documents are _never_ hard
  deleted — a sale is voided or returned, preserving history and audit integrity.

### Core entity groups

**Identity & access** — `users`, `roles`, `role_permissions`, `user_permission_overrides`,
`sessions`, `audit_log`.

**Parties** — `customers`, `suppliers`, and a unified `party_ledger` of signed entries so a
customer's debt and a supplier's outstanding balance are computed from an auditable trail rather
than a mutable number.

**Catalogue** — `categories` (self-referencing tree), `brands`, `units`, `products`,
`product_variants`, `barcodes`.

> **Key decision:** every product has **at least one variant**. Plain products get an implicit
> default variant. Sales, purchases and stock always reference `variant_id`, so Fashion's
> colour/size matrix needs no schema fork and no nullable-branching in inventory code.

**Inventory** — `warehouses`, `stock_movements` (append-only, signed quantity, document reference),
`stock_levels` (derived cache of on-hand quantity + moving-average cost), `stock_counts`,
`stock_count_lines`.

> **Key decision:** `stock_movements` is an immutable ledger. Corrections are new reversing entries,
> never updates. `stock_levels` is a cache rebuildable from the ledger — which gives a cheap
> self-audit: _recompute and compare_.

**Sales** — `sales`, `sale_lines` (with a COGS snapshot per line so historic profit stays correct
when costs change), `sale_payments`, `sale_returns`, `sale_return_lines`.

**Purchases** — `purchases`, `purchase_lines`, `purchase_payments`, `purchase_returns`,
`purchase_return_lines`.

**Money movement** — `payments`, `expense_categories`, `expenses`, `cash_shifts`, `cash_movements`.

**System** — `schema_migrations`, `settings`, `document_sequences`, `attachments`, `license_state`,
`terminals`, `backups`.

### Integrity mechanisms

- Foreign keys on every reference, with deliberate `ON DELETE RESTRICT` for anything a document
  points at — an invoice must never lose its product row.
- `CHECK` constraints on enums, non-negative amounts and sign rules.
- `UNIQUE` on `barcodes.code`, `products.sku`, `(sale.number, terminal)`, and on
  `client_txn_id` — the idempotency key that makes duplicate submission impossible (§10).
- Triggers that `RAISE(ABORT)` on `UPDATE`/`DELETE` against `audit_log`, so an employee with
  database access still cannot rewrite history from inside the application.
- `PRAGMA integrity_check` + `foreign_key_check` on startup after an unclean shutdown, and as a
  mandatory gate during backup restore.

### Indexing strategy

Covering indexes for the hot paths: barcode lookup, product name prefix search (Arabic and English),
sales by date range, sales by customer, stock movements by variant+warehouse, ledger by party, audit
by entity. Index choices are validated against the seeded large dataset (§21), not guessed.

---

## 6. Module Dependency Map

```
                        ┌────────┐
                        │  core  │  Money · Quantity · Result · ULID · Clock
                        └───┬────┘
             ┌──────────────┼──────────────┬───────────────┐
         ┌───▼───┐      ┌───▼───┐      ┌───▼───┐      ┌────▼────┐
         │domain │      │  db   │      │  ipc  │      │i18n · ui│
         └───┬───┘      └───┬───┘      └───┬───┘      └────┬────┘
             └──────┬───────┘              │               │
                ┌───▼────┐                 │               │
                │ engine │◄────────────────┘               │
                └───┬────┘   services · repositories ·     │
                    │        licensing · backup · audit    │
                    └──────────────┬───────────────────────┘
                            ┌──────▼───────┐
                            │  apps/pos    │ … and the other nine products
                            └──────────────┘
```

Products never reach past `engine` into `db`. Shared engine services are consumed through
interfaces, so Restaurant can substitute a recipe-aware stock-consumption strategy without forking
the sales service.

---

## 7. Security Architecture

**Electron hardening** — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity: true`, no remote module. The renderer loads only local assets; navigation to external
origins and all `window.open` calls are denied by handler. A strict CSP forbids inline script and
remote code.

**IPC** — the preload bridge exposes a fixed, hand-written allow-list of channels. Every handler
validates its payload with Zod before touching a service. A renderer compromise cannot reach the
filesystem or run arbitrary SQL, because no such channel exists.

**Authentication** — passwords hashed with **Argon2id** (memory-hard, resists GPU cracking), per-user
salt, parameters recorded per hash so they can be raised later. No password is ever logged. Failed
attempts are rate-limited with exponential backoff; lock screen on idle.

**Authorisation** — permission checks live in the **application layer**, never in the UI. Hiding a
button is a UX nicety, not a control. Services receive an actor and assert capability before acting.

**SQL** — exclusively parameterised statements. No string concatenation of user input into SQL,
anywhere, enforced by review and lint.

**Files & paths** — every user-supplied path is resolved and verified to sit under an allowed root
before use, defeating traversal. Backups and attachments get generated names, never raw user input.

**Clinic privacy** — medical notes carry stricter permissions than POS data and are excluded from
general reports and exports unless the actor holds explicit clinical permissions. Access to a patient
record is itself audited.

**Secrets** — no credentials in source. The licence **private key lives only on the vendor's signing
machine**; the application ships the public key.

**Diagnostics** — structured logs with rotation, written locally. Technical detail goes to the log;
the user sees an actionable message. Errors are never silently swallowed (§37).

---

## 8. Backup Architecture

Backups are the feature that decides whether a shop trusts this software after its first disk
failure, so correctness takes precedence over convenience.

- **Mechanism**: SQLite's online backup API via better-sqlite3 — a consistent snapshot without
  closing the app or blocking the cashier.
- **Artefact**: a single `.xzbak` (zip) containing `database.sqlite`, plus `manifest.json` with
  product id, schema version, app version, row counts, creation time, and a SHA-256 of the database.
- **Triggers**: manual, scheduled (interval and on-close), and an automatic **recovery point** before
  any destructive operation (restore, migration, bulk delete).
- **Retention**: generational — keep N daily, N weekly, N monthly. Never prune the only copy.
- **Destinations**: configurable local folder or external drive; absence of the drive is a warning,
  not a crash.

**Restore is a validated pipeline, and refuses rather than risks data:**

1. Verify zip integrity and the manifest SHA-256.
2. Extract to a temp location; run `integrity_check` and `foreign_key_check`.
3. Confirm product id matches and schema version is not _newer_ than the running app.
4. Snapshot the current live database as a recovery point.
5. Swap atomically; run migrations if the backup is older.
6. On any failure, roll back to the recovery point and report precisely what failed.

A healthy database is never overwritten by an unvalidated backup.

---

## 9. Licensing Architecture

The goal is a licence system that is honest about what it protects: it should stop casual copying and
support legitimate customers, **not** hold business data hostage.

**Licence file** — a signed token (**Ed25519**; vendor holds the private key, app embeds the public
key). Payload: `licenseId`, `productId`, `edition` (Trial/Basic/Professional/Business),
`customerName`, `issuedAt`, `expiresAt` (trial only), `features[]`, `maxUsers`, `deviceBinding`,
`versionEntitlement`. A forged licence is computationally infeasible without the private key; no
network call is needed to verify one.

**Device binding** — a fingerprint hashed from stable machine identifiers, with a tolerance so a RAM
upgrade or new peripheral does not invalidate a licence.

**Activation** — two paths, because reliable Internet cannot be assumed:

- _Online_: POST fingerprint + licence key, receive the signed licence.
- _Offline_: the app shows a request code; the vendor's tool returns a signed activation response
  that is typed or imported from a file. Fully functional with no connection, ever.

**Storage** — licence state in `%APPDATA%` plus a mirrored copy in the database; they are
cross-checked. Monotonic timestamp tracking detects clock rollback used to extend a trial.

**Enforcement — explicitly non-destructive.** If validation fails, the app enters **Restricted
Mode**: read-only access to all data, plus backup and export still fully available. It will _never_
delete data, corrupt the database, lock records, or touch the OS. Hardware replacement is handled by
a vendor-supported deactivate/re-activate path.

**Editions** are feature flags resolved from the licence by a `FeatureGate` service queried by both
services and UI — one codebase, no per-edition forks.

---

## 10. Correctness Guarantees for Money and Documents

Three rules protect financial integrity:

1. **Integer money.** All arithmetic in piastres; multiplication/rate application goes through
   `BigInt` internally and asserts safe-integer range on return. Half-up rounding at a single,
   explicit point per calculation. Split-bill and multi-payment allocation uses largest-remainder
   distribution so the parts always re-sum exactly to the whole — no lost piastre.
2. **Atomic documents.** A sale writes its header, lines, payments, stock movements, ledger entries
   and audit record inside **one** SQLite transaction. A crash or power cut mid-save leaves either a
   complete sale or no sale, never a half-sale that corrupts stock.
3. **Idempotency.** Every document-creating command carries a client-generated `client_txn_id` with
   a `UNIQUE` constraint. A double-click, a retried IPC call or a stuck scanner cannot create a
   duplicate invoice: the second attempt returns the first result.

---

## 11. Installer & Update Architecture

- **NSIS** installer from electron-builder: Start Menu shortcut, optional desktop shortcut, clean
  uninstall, Arabic and English installer strings.
- **Data separation is absolute.** Database, settings, licence, backups and logs live in
  `%APPDATA%\Xzare\<Product>\`, never in the install directory. Uninstall and update therefore
  cannot destroy business data; uninstall asks before removing data and defaults to keeping it.
- **Updates** are opt-in and check-on-demand by default, respecting the perpetual licence: a customer
  who bought version 2 keeps using version 2 indefinitely. Migrations run forward-only after an
  automatic pre-update recovery point, and the app refuses to open a database created by a _newer_
  schema rather than damaging it.

---

## 12. Testing Strategy

| Level       | Tool                             | Target                                                                                                                                                          |
| ----------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Vitest                           | Domain purity: money, rounding, allocation, totals, discounts, taxes, stock maths, recipe explosion, commissions. Fast, no I/O.                                 |
| Integration | Vitest + real SQLite (temp file) | Services end-to-end through the database: sale→stock→ledger→audit, returns, partial payments, shift close, migrations up from empty, backup/restore round-trip. |
| Contract    | Vitest                           | Every IPC channel validates and rejects malformed payloads.                                                                                                     |
| E2E         | Playwright (Electron)            | Cashier flow with keyboard and simulated scanner; Arabic RTL layout; receipt print to PDF.                                                                      |
| Performance | Seeded dataset (tools/seed)      | 100k products, 1M invoice lines: search latency, start-up time, report generation, memory ceiling.                                                              |

Required edge cases, tested rather than assumed: crash during invoice save, power failure mid
transaction, duplicate barcode, negative stock attempt, invalid/truncated backup, product referenced
by an old invoice, return against an old invoice, partial payment, very large database, Arabic names
and RTL receipt rendering, long receipts, clock rollback, concurrent shift operations.

---

## 13. Risks and Mitigations

| Risk                                          | Impact                                       | Mitigation                                                                                                                            |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Floating-point money errors                   | Loss of customer trust, unreconcilable books | Integer piastres everywhere; `REAL` banned for money; property-based rounding tests                                                   |
| Data loss on disk failure                     | Business-ending for the customer             | Generational validated backups, recovery points, restore integrity gate                                                               |
| Arabic/RTL treated as an afterthought         | Product feels foreign; rejection in market   | RTL in the design system from day one; Arabic receipt printing proven early, not late                                                 |
| Thermal printer variability                   | Receipts fail at the counter                 | Abstract printing behind an interface; test ESC/POS 58mm & 80mm plus A4; always offer PDF fallback                                    |
| SQLite corruption from unclean shutdown       | Downtime                                     | WAL, `synchronous=FULL`, startup integrity check, automatic recovery point                                                            |
| Licence check false-positives                 | Legitimate shop blocked at opening time      | Non-destructive Restricted Mode (read + backup + export), generous device-binding tolerance, offline activation, vendor recovery path |
| Scope sprawl across thirty products           | Nothing ships                                | Strict phase order (§39); engine first, POS second; no new product until the previous is stable                                       |
| Monolith drift / tight coupling               | Expensive rewrites                           | Enforced layer dependency rule; `domain` has zero I/O imports                                                                         |
| Performance collapse on large datasets        | Unusable for established shops               | Pagination/virtualisation by default, measured indexes, seeded 1M-row tests                                                           |
| Native module (better-sqlite3) build friction | Broken CI/installer                          | Pin Electron and Node versions; rebuild in CI; verify the packaged binary launches                                                    |
| Over-claimed accounting features              | Legal and reputational exposure              | Report names state exactly what they compute; no "financial statements" claim until double-entry exists (§27)                         |

---

## 14. Decision Log

| #   | Decision                            | Reason                                                                          |
| --- | ----------------------------------- | ------------------------------------------------------------------------------- |
| D1  | Electron + TypeScript               | Windows packaging, peripheral access, one language, local talent pool           |
| D2  | better-sqlite3, no ORM              | Synchronous transactions eliminate async interleaving; explicit SQL and indexes |
| D3  | Integer piastres for money          | Float arithmetic is unacceptable in commercial finance                          |
| D4  | ULID TEXT primary keys              | Sortable, offline-generatable, sync-ready                                       |
| D5  | Every product has ≥1 variant        | One inventory code path for plain and variant products                          |
| D6  | Append-only stock & audit ledgers   | Auditability; cache rebuildable and self-verifiable                             |
| D7  | Permissions enforced in services    | UI hiding is not a security control                                             |
| D8  | Non-destructive licence enforcement | Customer data is never the hostage                                              |
| D9  | App data outside install dir        | Updates and uninstall cannot destroy business data                              |
| D10 | Idempotency keys on all documents   | Structurally prevents duplicate invoices                                        |
