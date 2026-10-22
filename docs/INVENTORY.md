# Xzare Inventory 0.1.0

Standalone warehouse application, product #4. Separate SQLite identity, app data, device-bound product license and validated backups. Arabic desktop interface; currency EGP. No demo business data is included.

## Operations
Create barcode-linked catalog items and warehouse names. Receipts store total acquisition cost per line. Issues use carrying cost and reject expired batches or insufficient warehouse stock. Transfers conserve quantity and cost. Each serial identifies exactly one unit and cannot be reused after issue; relocation retains identity. Batch expiry is fixed on first receipt.

Counts capture expected quantity/value at editor open and explicit physical quantity. Engine rejects stale snapshots. Positive variance needs total cost of additional quantity; negative variance uses carrying cost. All count observations persist, including zero differences. Posted documents/movement/observations/audit are immutable. Corrections use new documented movements. Expired spoilage is documented through counts.

## Roles and safety
Administrator controls users, settings, license and restore. Manager controls catalog, warehouses and stock movements. Viewer can inspect reports only. Stock documents are transactional and actor-bound idempotent. Catalog, balances and movement ledger must reconcile before a new stock document can post. Generic POS stock/sale calls are blocked.

## Reports and backup
Warehouse/item/date-filtered movement report reads complete ledger; overview document list displays newest 1000. Balance reports are current, independent of movement date range. CSV values neutralize spreadsheet formulas. Printing supports PDF through print dialog; barcode label rendered only when requested. Backups omit license secrets, validate schema and ledger protections, reject other products, and revoke sessions after restore.

## Build and delivery
Run node tools/tasks.mjs verify; build:inventory; package:inventory. Local review preview: 127.0.0.1:5206. QA data stays exclusively under .cache. Installer and win-unpacked are delivered together with SHA256.

## Release status
The packaged review build has no deployed licensing origin and no publisher code-signing certificate configured. Secure desktop requires real activation to allow business writes. Production sale requires configuring and verifying your actual HTTPS licensing service and signing the installer. No promise of zero compromise or uncopyable desktop code is made.
