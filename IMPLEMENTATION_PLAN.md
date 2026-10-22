# Xzare Business Suite — Implementation Plan

Companion to `ARCHITECTURE.md`. Milestones are small and independently verifiable. A milestone is
**done** only when it builds, its tests pass, and its workflow has been exercised end to end.

Legend: `[ ]` not started · `[~]` in progress · `[x]` complete & verified

## Delivered POS v0.1.0 — 2026-10-03

An operating desktop POS now implements the baseline across M2–M17. Current verified scope and
limits are in [POS_OPERATIONS.md](./docs/POS_OPERATIONS.md). The milestone definitions below remain
the broader suite roadmap: multi-warehouse/variants/granular permission overrides, exhaustive
report families, direct thermal/A4 output, complete translation, migration between future schemas,
online activation, updater and large-data/hardware acceptance have not all been delivered.

Evidence: `node tools/tasks.mjs verify`, 304 tests in22 files; Playwright cashier/credit/hold/return/
weight-label/backup/shift workflow; native packaged Electron integration diagnostic; unsigned NSIS
installer built. Six independent review findings fixed with regression coverage. No business seed
data, default credentials, or vendor private key is included in customer builds.

---

## Phase 1 — Xzare Business Engine

### M0 — Repository foundation `[x]`

pnpm workspace, strict TypeScript, Vitest, Prettier, git. Planning documents committed.
**Verify:** `pnpm build` and `pnpm test` succeed on an empty-but-wired tree.

### M1 — `@xzare/core` primitives `[x]`

`Money` (integer piastres: parse, format, arithmetic, basis-point rates, largest-remainder
allocation), `Quantity` (milli-units), `Result`, error taxonomy, ULID, `Clock`, logger interface.
**Verify:** exhaustive unit tests including rounding boundaries, allocation re-summing exactly, and
safe-integer overflow rejection.

### M2 — `@xzare/db` foundation `[ ]`

Connection with pragmas (FK, WAL, `synchronous=FULL`, busy timeout), forward-only migrator,
synchronous unit-of-work transactions, integrity checks, atomic document-number sequences.
**Verify:** migrate-from-empty test, rollback-on-throw test, concurrent-sequence test.

### M3 — Core schema (migration 001) `[ ]`

All tables from `ARCHITECTURE.md` §5, with FKs, CHECKs, UNIQUEs, indexes, and the append-only
`audit_log` triggers.
**Verify:** schema applies cleanly; `integrity_check` and `foreign_key_check` pass; trigger blocks
`UPDATE`/`DELETE` on `audit_log`.

### M4 — Identity, permissions, audit `[ ]`

Argon2id password hashing, login/session/lock screen, roles, granular permissions with per-user
overrides, service-layer permission assertions, audit writer.
**Verify:** unauthorised action is rejected at the service layer even when the UI is bypassed;
audit rows are written and provably immutable.

### M5 — IPC contracts & secure bridge `[ ]`

`@xzare/ipc` channel registry with Zod schemas; hardened `BrowserWindow`; preload allow-list.
**Verify:** malformed payloads are rejected per channel; `nodeIntegration` off and
`contextIsolation` on asserted in test.

### M6 — i18n, RTL & design system `[ ]`

Arabic/English dictionaries, direction switching, EGP and `ar-EG` formatters, Tailwind v4 logical
properties, core components (Button, Input, MoneyInput, DataTable with search/sort/filter/paging,
Modal, Toast).
**Verify:** language switch flips layout with no mirrored-icon or truncation defects; Arabic numerals
and currency format correctly.

### M7 — Catalogue & parties `[ ]`

Categories, brands, units, products, variants (implicit default variant), barcodes, customers,
suppliers, party ledger.
**Verify:** duplicate barcode rejected; fast search on a seeded 100k-product catalogue.

### M8 — Inventory ledger `[ ]`

Append-only `stock_movements`, derived `stock_levels`, moving-average cost, adjustments, transfers,
damage, stock count, low-stock alerts, valuation, movement history.
**Verify:** `stock_levels` recomputed from the ledger matches the cache exactly after a randomised
operation sequence.

---

## Phase 2 — Xzare POS

### M9 — Sales & POS core `[ ]`

Cashier screen (keyboard + scanner first), line discounts and invoice discounts, tax, multi-payment,
partial payment, customer credit, hold/resume, atomic save with `client_txn_id` idempotency.
**Verify:** double-submit creates exactly one invoice; crash mid-save leaves no partial sale.

### M10 — Returns & refunds `[ ]`

Full and partial returns against an invoice, refund payment, stock restoration, return against an
old invoice whose product has since changed price or been deactivated.
**Verify:** over-return is impossible; COGS snapshot keeps historic profit correct.

### M11 — Purchases & suppliers `[ ]`

Purchase invoices, costs, discounts, taxes, payments, supplier balance, purchase returns,
attachments, correct stock and average-cost updates.

### M12 — Cash, shifts & expenses `[ ]`

Cashbox, shift open/close, expected vs actual cash with variance, cash in/out, expense categories and
entries, full audit trail.

### M13 — Printing engine `[ ]`

ESC/POS thermal 58mm and 80mm, A4 invoice, barcode labels, print preview, PDF fallback, configurable
header/logo/footer/tax fields. **Arabic shaping verified on real output.**

### M14 — Reporting engine `[ ]`

Reusable report framework: daily/monthly sales, by product/category/employee, gross profit, expenses,
inventory valuation, low stock, best sellers, customer/supplier balances, purchases, returns, cashbox,
shifts. Date filters, print, PDF, CSV/Excel. Labels state precisely what is computed — no implied
statutory accounting.

### M15 — Backup & restore `[ ]`

Online-backup snapshots, `.xzbak` with manifest and SHA-256, scheduling, generational retention,
validated restore pipeline with recovery point and rollback.
**Verify:** truncated and foreign-product backups are refused; healthy database survives a failed
restore untouched.

### M16 — Licensing & editions `[ ]`

Ed25519 licence verification, trial, device binding with tolerance, online and offline activation,
clock-rollback detection, non-destructive Restricted Mode, `FeatureGate`, vendor signing CLI.
**Verify:** tampered licence yields read-only + export, never data loss; offline activation completes
with networking disabled.

### M17 — Installer, updates, crash recovery `[ ]`

NSIS installer, data in `%APPDATA%`, clean uninstall that preserves data by default, opt-in updates
with pre-update recovery point, startup integrity check after unclean shutdown.
**Verify:** install → use → update → data, settings and licence all intact.

### M18 — Hardening & performance `[ ]`

Seeded 100k products / 1M lines; measure start-up, search, report latency; add measured indexes;
Playwright E2E for the cashier flow; full edge-case suite from `ARCHITECTURE.md` §12.

**Phase 2 exit criteria:** a shop can install Xzare POS, activate it offline, sell with a scanner,
print an Arabic receipt, take partial payment, close a shift, run profit reports, back up, restore,
and survive a power cut without data loss.

---

## Phases 3–7 (outline; detailed on entry)

- **Phase 3 — Stabilise:** harden inventory, sales, purchasing, printing, reports, backup, licensing
  under real-world use before adding products.
- **Phase 4 — POS Fashion & Mobile editions:** variant matrix for fast stock entry; IMEI/serial tracking,
  warranty, repair job cards, device history.
- **Phase 5 — Restaurant:** tables/floors, dine-in/takeaway/delivery, KDS, kitchen printers,
  modifiers, recipes with ingredient consumption and costing, split/merge/transfer bills.
- **Phase 6 — Auto Workshop:** vehicles, job cards, diagnosis, parts + labour, technicians, full
  service history.
- **Phase 7 — Clinic, Gym, Salon, Inventory & Accounting, Contracting:** stricter medical access
  control; memberships and check-in; configurable auditable commissions; multi-warehouse and
  valuation; project costing and profitability.

---

## Working Agreement

The product scope is now thirty distinct workflows in [PRODUCT_PORTFOLIO.md](./docs/PRODUCT_PORTFOLIO.md).
The phases above remain initial delivery order; editions share POS and do not introduce separate cores.
Barcode foundation implemented in `packages/barcode` is documented in [BARCODE_ENGINE.md](./docs/BARCODE_ENGINE.md);
catalog lookup, transactional sale integration and browser/Windows print flow are implemented in POS.
Physical hardware printing remains unverified.

Per `ARCHITECTURE.md` §37 and the master prompt:

1. Requirement → data model → business rules → validation → permissions → failure cases → domain
   logic → UI → tests → full-workflow test.
2. No placeholder features. No non-functional buttons. Nothing is reported complete unless verified.
3. Errors surface understandably to the user and in detail to the log — never swallowed.
4. After each milestone: build, test, fix, verify the workflow, update this file, commit.

---

## Progress Log

| Date       | Milestone    | Outcome                                                                                                                                                                                                        |
| ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-01 | M0           | Workspace, strict TS, Vitest, Prettier, planning docs. Build + test green.                                                                                                                                     |
| 2026-10-01 | M1           | `@xzare/core`: Money, Quantity, Result, errors, ULID, Clock, logger.                                                                                                                                           |
| 2026-10-03 | M1 hardening | Strict bounded parsing, signed rounding, safe diagnostic/client errors, Web Crypto portability, exact cost allocation and restore. `pnpm verify`: 218 tests in 13 files. Independent review findings resolved. |
