# Xzare Inventory Implementation Plan

> Execute inline with executing-plans and verify each phase.

**Goal:** Standalone warehouse product with complete Windows build.
**Architecture:** Dedicated inventory schema/domain on shared identity/barcode/runtime.
**Tech Stack:** TypeScript, SQLite, React, Electron, Vitest.

## Constraints
Empty business database; integer quantities and money; actor-bound idempotency; no inventory bypass via POS calls; separate license/backup identity.

### 1. Engine
- [ ] Create packages/engine/src/inventory.test.ts: receive 10, issue 3, transfer 2; source 5 destination 2; conserved cost; rollback insufficient stock; replay same txn once; changed txn denied; expired lot/serial duplicate denied; stale count denied; cashier denied.
- [ ] Run Vitest red, implement inventory-schema.ts, inventory-validation.ts and inventory.ts, then verify green.
### 2. Integration
- [ ] Add Inventory ProductKind, database identity and immutable tables; runtime actions, readable calls, service dispatch and product licensing mapping. Test rejection of POS actions and foreign backup/license.
- [ ] Add apps/inventory package and shared desktop files, tasks + preview port 5206 + cookie.
### 3. Interface
- [ ] Build overview/catalog/warehouses/document/count/tracking/reports/settings pages. Forms submit quantities as exact integers; scanner lookup feeds selected variant. Reuse authenticated calls and shared security/settings UI; verify typecheck/build.
### 4. Verification
- [ ] Exercise real UI on isolated data: setup, two warehouses, barcode item, receipt, transfer, issue, stale/insufficient rejection, count. Verify reports and no console errors.
- [ ] Run suite and inspect security boundaries.
### 5. Delivery
- [ ] Build NSIS/win-unpacked, hash manifest, inspect ASAR/native fuses; copy full folder to D artifacts/Xzare Inventory and compare every hash.
