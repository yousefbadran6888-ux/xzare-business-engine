# Xzare Inventory design — 2026-10-04

Authorized scope: next standalone product (#4) from user portfolio, complete Windows artifacts, no fabricated business data; shared hardened Business Engine, masked online device-bound license.

Architecture: Inventory owns warehouse/lots/serials and immutable receipt/issue/transfer/count documents, uses shared users, barcode catalog, audit and backup. Distinct product ID and SQLite application ID. Only inventory and explicitly shared identity/settings/catalog calls allowed. Stock in integer milli-units; value in integer minor currency units. Average carrying cost per lot; transfer conserves quantity and value. Serialized item is exactly one unit; each serial stays associated with a single product/lot/warehouse and is never reused after issue. Batch expiry blocks expired issues. Posted documents cannot edit/delete; all mutations transactional and actor-bound idempotent. Counts use an explicit expected balance to reject stale counts. All commands validate strict input; cashier cannot mutate inventory.

UI: Arabic default, shared secure setup/login; overview, searchable catalog + barcode labels, warehouses, receive/issue/transfer document editor, count differences, batches/serial lookup, filtered balance/movement CSV and printable reports, user/settings/license/backup. Empty database only; no sample orders/stock/users. Persisted stock is engine-computed, never browser-computed.

Delivery: version 0.1.0 installer, blockmap, SHA256, complete win-unpacked under artifacts/Xzare Inventory. Verify engine edge cases, isolation/backup/license, suite/typecheck/build, real browser workflow, packaged ASAR and copied file hashes. Real licensing service endpoint and signing are existing external release requirements.
