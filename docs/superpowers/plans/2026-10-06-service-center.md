# Xzare Service Center Implementation Plan
> For agentic workers: execute inline with executing-plans and use requesting-code-review after major changes.
**Goal:** Complete product7 Windows device repair app and named artifact folder.
**Architecture:** Independent ServiceCenter domain composed with Identity and Inventory; dedicated schema, runtime route allowlist and license product. Reuse neutral forms/desktop infrastructure, create device/warranty UI.
**Tech Stack:** TypeScript/SQLite/Zod/React/Vite/Electron/Vitest.
## Global constraints
Arabic/EGP, single company, no dummy data, hidden device license, real inventory and immutable cost/payment history. Covered returns refer to original delivered regular order and never renew its warranty. D write access only for final artifacts.
### Task1: Domain and tests
Files: packages/db/src/service-center-schema.ts; packages/engine/src/service-center-validation.ts, service-center.ts, service-center.test.ts; packages/db/src/index.ts; packages/engine/src/service.ts and index.ts.
- [ ] Write real RPC tests: device uniqueness/frozen serial; intake snapshots; latest quote approval; actual FEFO/serial inventory; partial payment and unpaid handover guard; immutable/idempotent actor history; manager/read-only role; quote rounding/limits; warranty eligibility/expiry/no-chain/zero-charge cost and replay.
- [ ] Run vitest service-center.test.ts --configLoader runner, confirm missing product behavior red.
- [ ] Add schema and domain actions with transactional history, inventory cost allocations and warranty guards; rerun green.
### Task2: Runtime, backup and licensing
Files runtime.ts, backup.ts, licensing enums/CLI; tools tasks/preview/package inspection/desktop bootstrap; apps/service-center/*; tsconfig/root scripts.
- [ ] Real integration tests for foreign backup identity, restore sessions, action allowlist and product-specific licensing red.
- [ ] Register service-center product and native online licensing. Use xzare-service-center and applicationID0x585a5343. Preserve other products.
- [ ] Rerun targeted tests/typecheck green.
### Task3: UI and package
Files apps/service-center/src/{App,ServiceCenterWorkspace,OrderDetail,EstimateEditor,model,ui,service-center.css}; own SVG/ICO.
- [ ] Device intake/condition/accessories/history and warranty acceptance, quote/repair/payment/handover, reports/CSV, neutral stock/security settings.
- [ ] Test isolated actual UI workflow with shortage, receipt, serial barcode, payment and linked covered return. Public setup remains empty.
- [ ] Verify whole suite/build; reviewer checks data/authorization/warranty/UI consistency.
- [ ] Package via node tools/tasks.mjs package:service-center, inspect package then native empty startup.
- [ ] Docs/checksums and authorized D copy. All delivered paths and hashes match source; log evidence.
