# Xzare: thirty products on shared engines

This is the user's approved product scope and implementation map, not a list of thirty shipped applications. POS 0.3 and Restaurant 0.1 now have separate desktop applications and review installers built on the working Identity/Commerce/Inventory/database/barcode engines. Restaurant adds table orders, KDS, frozen recipes and costs, driver delivery, reservations and waste reporting. The other 28 products remain planned. Customer release still requires live licensing, publisher signing and real-device acceptance. See [Restaurant operations](RESTAURANT_OPERATIONS.md).

Every product shares Identity (users, roles, audit), Finance (payments/cash as applicable), database infrastructure, Arabic/English support, backup, licensing and reporting/printing infrastructure. Industry modules add genuine business workflows rather than cloning the core.

| #   | Product                | Target workflow                                          | Additional engine composition                            |
| --- | ---------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Xzare POS              | Retail cashier, purchases, stock, shifts                 | Commerce + Inventory + barcode                           |
| 2   | Xzare Restaurant       | Tables, KDS, recipes, delivery                           | Commerce + Inventory + Booking + restaurant module       |
| 3   | Xzare Accounting       | Chart of accounts, journals, ledgers, trial balance      | Finance + accounting module                              |
| 4   | Xzare Inventory        | Warehouses, counts, transfers, batches/serials           | Commerce/Inventory + barcode                             |
| 5   | Xzare Manufacturing    | BOM, MRP, production orders, waste, costing              | Manufacturing + Commerce/Inventory                       |
| 6   | Xzare Workshop         | Vehicles, work orders, technicians, parts                | Service + Commerce/Inventory + vehicle module            |
| 7   | Xzare Service Center   | Device intake, diagnosis, repairs, warranty              | Service + Commerce/Inventory + device module             |
| 8   | Xzare Clinic           | Patients, doctors, appointments, visits, invoices        | Service + Booking + clinical module                      |
| 9   | Xzare Laboratory       | Samples, test orders, validated results, reports         | Service + laboratory module + sample identity adapter    |
| 10  | Xzare Pharmacy         | Medicines, expiry, batches, alternatives                 | Commerce/Inventory + pharmacy module                     |
| 11  | Xzare HR               | Attendance, shifts, leave, payroll, appraisal            | HR + Finance                                             |
| 12  | Xzare CRM              | Leads, pipelines, follow-ups, opportunities              | CRM + Commerce as needed                                 |
| 13  | Xzare Education        | Students, groups, attendance, fees, exams                | Membership + Booking + education module                  |
| 14  | Xzare Gym              | Memberships, check-in, trainers, renewals                | Membership + Booking                                     |
| 15  | Xzare Salon            | Appointments, services, commissions, packages            | Booking + Service + Membership as needed                 |
| 16  | Xzare Hotel            | Rooms, reservations, check-in/out, housekeeping          | Booking + Service + hotel module                         |
| 17  | Xzare Real Estate      | Units, owners, sale/lease contracts, commissions         | CRM + real-estate contracts module                       |
| 18  | Xzare Property Manager | Tenants, rent collection, maintenance                    | Service + property-contracts module                      |
| 19  | Xzare Contracting      | BOQ, materials, subcontractors, project profit           | Project + Commerce/Inventory + contracting module        |
| 20  | Xzare Project Manager  | Tasks, timesheets, budgets, billing                      | Project + Service                                        |
| 21  | Xzare Rental           | Assets, reservations, deposits, handover, penalties      | Booking + Service + asset module                         |
| 22  | Xzare Logistics        | Shipments, trips, drivers, COD                           | Logistics + Finance + shipment identity adapter          |
| 23  | Xzare Distribution     | Reps, routes, van sales, orders, collection              | Commerce/Inventory + Logistics                           |
| 24  | Xzare Fleet            | Vehicles, fuel, maintenance, drivers, expenses           | Service + fleet module                                   |
| 25  | Xzare Field Service    | Tickets, technician visits, SLA, parts, contracts        | Service + Booking + Commerce/Inventory                   |
| 26  | Xzare Legal            | Cases, hearings, documents, fees                         | Project + Booking + legal module                         |
| 27  | Xzare Agriculture      | Crop cycles, inputs, labour, yield, cost                 | Manufacturing + Project + agricultural module            |
| 28  | Xzare Laundry          | Garment intake, wash stages, delivery                    | Service + Logistics as needed                            |
| 29  | Xzare Printing House   | Job orders, dimensions, materials, stages, pricing       | Manufacturing + Project + print-production module        |
| 30  | Xzare Business ERP     | Unified accounting, sales, purchases, inventory, CRM, HR | Composition of implemented engines, no duplicate ledgers |

## Editions and boundaries

Fashion, Supermarket, Electronics, Mobile, Auto Parts, Building Materials and Wholesale are **POS editions**, composed with variants, serials, warranties, units or pricing modules. They are not separate cores or additional products in the count. Dental, physiotherapy and dermatology remain Clinic editions unless their distinct workflow justifies a separate product.

Barcodes identify objects; they do not grant access. Retail product, scale PLU, sample, garment ticket, shipment and serial namespaces are separate and have different policies. The current CODE128 subset and scale codec must not silently stand in for GS1 healthcare, sample-result authentication, tracking URLs or lot/expiry parsing. Domain adapters must explicitly define those formats before use.

## Delivery order and acceptance

1. Complete database transactions, Identity, permissions, audit, backup and licensing around the verified core primitives.
2. Complete Commerce/Inventory and one real POS workflow using the shared barcode package, real product catalog and physical printing tests.
3. Validate POS under interrupted operations and real shop use; add editions through modules.
4. Deliver distinct products one workflow at a time, reusing tested engines. Accounting requires double-entry and ledger reconciliation before financial-statement claims; Pharmacy requires expiry/batch controls; Laboratory requires result validation and role separation before clinical operation.

Each product must have its own acceptance workflow, permission matrix, failure cases, real persisted operations and install/backup/restore verification. A screen, feature flag, product name or copied cashier page is not a completed product. This map expands the initial ten-product outline; implementation milestone labels remain stable, with additional product-specific plans created as workflows are implemented.
