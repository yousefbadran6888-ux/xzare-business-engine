# Xzare Manufacturing 0.1.0 — design

Product #5 from the user portfolio, following Inventory. Standalone Arabic Windows app, one company/EGP, hardened shared identity/barcode/inventory/license/backup; no seeded commercial data. Deliver installer + complete win-unpacked + blockmap/hash/guides to D:/Xzare-POS/artifacts/Xzare Manufacturing.

## Workflow
Barcode catalog and named warehouses. Versioned immutable single-level BOM: finished variant, yield quantity and component milli-unit quantities plus optional material waste allowance basis points. Orders retain BOM revision, requested output quantity, source/destination warehouse, due date, reference. Planned orders can cancel with reason. Started orders cannot cancel; consumed material cannot silently return.

Start atomically checks live reconciled inventory, consumes gross requirements rounded upward using BigInt, FEFO nonexpired lots, and records immutable material allocations/cost and inventory issue document. Insufficient materials or fractional serial consumption reject all changes. Work in progress holds consumed cost. Complete once with explicit good + scrap = planned, labor and overhead costs, output batch/expiry or unique serials (<=100). All cost absorbed into good output; all-scrap orders write off full cost. Expired output rejected. Good output receipt, production event and cost close share a transaction. Retried actor-bound command returns exact result without duplicate stock.

MRP groups direct BOM gross requirements for planned orders by warehouse/material; usable stock excludes expired lots; shortages cannot be masked by other warehouses. Versioned BOM revisions exclude output-as-component and graph cycles. Assemblies can be components, but multi-level scheduled/capacity MRP is outside0.1. Cost report shows WIP, completed input/conversion costs, unit cost, scrap quantity and full-scrap writeoffs; full history date filtering.

## Boundary
Separate SQLite appID0x585a4d46 and schema, product xzare-manufacturing, isolated desktop app data, strict runtime/IPC actions. Old sale/stock.adjust/accounting/restaurant calls unavailable. Shared warehouse movements real. Admin identity/settings/restore; manager manufacturing/stock/catalog; cashier view-only. BOM/allocations/events immutable; order transitions guarded in SQL. Backup validates manufacturing schema and rejects other products; contains no license secrets; restore requires admin password and ends sessions.

## UI
Manufacturing dashboard/action rail, BOM revisions/editor with barcode component lookup, production orders/detail timeline/requirements/cost, MRP and shortages, materials/catalog/barcode labels, warehouses/stock operations/counts/tracking, cost/movement reports, users/audit/settings/license/backup. Auth/setup copy manufacturing-specific. No fake rows, no visible stored activation code.

## Verification and sale prerequisites
Real engine tests for BOM revision/snapshot, ceil rounding, shortages/FEFO/serials, transitions, WIP/cost conservation, scrap/replay/rollback, actor roles, product isolation, license binding, backup restore. Full shared suite/typecheck and browser real workflow; independent review; actual package fuses/runtime and no-secret/DB/test check; full destination hash comparison. Existing license origin null and unsigned publisher certificate means review release only, native writes gated until real HTTPS activation. No zero compromise claim.
