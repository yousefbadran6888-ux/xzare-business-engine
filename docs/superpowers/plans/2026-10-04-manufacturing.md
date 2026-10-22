# Xzare Manufacturing Implementation Plan

> For agentic workers: use executing-plans task by task with checkpoints.

Goal: real standalone production lifecycle with complete Windows review artifacts.
Architecture: Manufacturing module composes Inventory commands within outer SQLite transactions; BOM/allocations/events immutable, orders guarded. Separate product identity and licensing.
Tech Stack: existing TypeScript/SQLite/Zod/React/Vite/Electron; no new dependencies.

## Global Constraints
Arabic UI, one company/EGP, no fake data, online bound license with offline grace, hidden key, existing public contact, review release pending issuer deployment/signing. BigInt upward milli-unit requirements and safe integer money <=1e12.

### Task1 — transactional manufacturing domain
Files: db/src/manufacturing-schema.ts, engine/src/manufacturing-validation.ts, manufacturing.ts, manufacturing.test.ts; db index and BusinessEngine integration.
Interfaces: manufacturing.state/bom.create/order.create/order.get/order.start/order.complete/order.cancel/mrp/report. All writes clientTxnId.
- [ ] Test missing state and BOM first: expect(state.boms).toEqual([]); createBOM(outputVariantId,yieldQty,components).
- [ ] Run node node_modules/vitest/vitest.mjs run packages/engine/src/manufacturing.test.ts --configLoader runner; expected unsupported operation.
- [ ] Implement strict schemas, immutable tables and transitions; BigInt ceiling (n+d-1n)/d, FEFO allocation excluding expiry<localDay; Inventory.call for issue/receipt nested atomic transaction.
- [ ] Verify material10001 consumed into WIP then finish good4000+scrap1000, labor200+overhead100 => output10301, repeated request exact replay. Failed receipt/insufficient stock leaves original order/documents intact.

### Task2 — trusted product integration
Files: runtime.ts, license*.ts, online-license.ts, tools/desktop-main.cjs, preview/start-preview/tasks/inspect-package/collect-notices/license-server; manufacturing-license.test.ts and manufacturing-backup.test.ts.
- [ ] Write license cross-product rejection and backup/restoration tests; run RED.
- [ ] Register manufacturing product/appID/action sets/readable calls/issuerCLI/preview5209, app data and backup types.
- [ ] Run integration GREEN and full verify.

### Task3 — actual usable UI and Windows target
Files: apps/manufacturing package/build/main/preload/vite/tsconfig, src/App.tsx, Manufacturing.tsx, BomEditor.tsx, OrderEditor.tsx, model.ts, manufacturing.css; shared AuthScreen product copy.
- [ ] Build own manufacturing screens with shared reusable stock editor/catalog/auth controls.
- [ ] UI snapshots retained at editor open; exact numeric parsing, stable request id retries, protected sessions/errors.
- [ ] Build node tools/tasks.mjs build:manufacturing; fix TS failures.

### Task4 — independent review and real workflow
- [ ] Verify full suite/typecheck; review roles/idempotency/stock+cost conservation/rollback/license/backup.
- [ ] Isolated preview5208: setup empty, create material/finished/BOM, receive material, reject shortage, start order, see WIP, complete partial scrap and conversion cost, match reports/stock, test same-quantity no unintended mutation. Public preview5209 remains empty.

### Task5 — full artifacts
- [ ] node tools/tasks.mjs package:manufacturing; inspect-package.mjs manufacturing.
- [ ] Write README-AR, REVIEW-STATUS, installer.sha256, SHA256SUMS; copy full artifacts to requested D folder and compare every path/size/hash.
- [ ] Update planning records and hand over concise Arabic links and actual external release prerequisites.
