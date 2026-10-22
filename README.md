# Xzare Business Software Suite

Commercial desktop business software for the Egyptian market — Arabic-first, offline-first, sold
under a one-time perpetual licence.

The planned **30 products** share the **Xzare Business Engine** through composable engines.
See [PRODUCT_PORTFOLIO.md](./docs/PRODUCT_PORTFOLIO.md) for the distinct workflows and implementation map.
Fashion, Mobile and other retail specialties are POS editions, sharing one commerce foundation.
The first operating application is **Xzare POS** in `apps/pos`: a real Arabic-first Windows
application with catalog, inventory, cashier, purchases, credit/payments/returns, customers and
suppliers, shifts/cash/expenses, reports, identity/roles/audit, backups and offline licensing.
The second application is **Xzare Restaurant 0.1** in `apps/restaurant`, with real tables,
kitchen tickets, frozen recipes/costs, delivery, reservations and waste reporting. It shares
management infrastructure with POS and uses a separate database, backup identity and product-bound
license. See [RESTAURANT_OPERATIONS.md](./docs/RESTAURANT_OPERATIONS.md). The other 28 products remain a roadmap.

Current Windows review installer: `artifacts/Xzare-POS-0.3.0-Setup.exe`.
Restaurant review installer: `artifacts/restaurant/Xzare-Restaurant-0.1.0-Setup.exe`.
Read [POS_OPERATIONS.md](./docs/POS_OPERATIONS.md) for first use, data paths, license issuance,
verification evidence and limits. This is an unsigned first release; hardware and normal Windows
sandbox execution outside the coding environment need acceptance testing before customer distribution.

## Documentation

| Document                                           | Contents                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| [ARCHITECTURE.md](./ARCHITECTURE.md)               | Stack decisions, layering, database design, security, backup, licensing, risks |
| [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) | Milestones with verification criteria and progress log                         |

## Requirements

- Node.js ≥ 22
- pnpm ≥ 10
- Target platform: 64-bit Windows 10/11

## Getting started

```bash
pnpm install --ignore-scripts
pnpm verify      # typecheck (sources + tests) then run the test suite
pnpm start:pos   # build and run the desktop application
pnpm dev:pos     # isolated local HTTP preview on 127.0.0.1:5191
pnpm start:restaurant # separate desktop application
pnpm dev:restaurant   # local restaurant preview on 127.0.0.1:5196
pnpm package:pos # build Windows NSIS installer
```

| Script            | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `pnpm build`      | Compile all packages via TypeScript project references |
| `pnpm typecheck`  | Typecheck sources **and** test files                   |
| `pnpm test`       | Run the test suite once                                |
| `pnpm test:watch` | Watch mode                                             |
| `pnpm format`     | Apply Prettier                                         |
| `pnpm verify`     | Typecheck + test — run this before every commit        |

## Packages

| Package            | Responsibility                                                                         |
| ------------------ | -------------------------------------------------------------------------------------- |
| `packages/core`    | Money, Quantity, pricing, Result, errors, ULID, Clock, logging                         |
| `packages/barcode` | Checked barcode identities, integer scale-label codec, focused scanner framing         |
| `packages/db`      | SQLite schema, integrity checks, immutable ledger triggers and transaction store       |
| `packages/engine`  | Identity, commerce/stock/cash services, validated backup/restore and licensing runtime |
| `apps/pos`         | React UI, hardened Electron process and preload, Windows packaging                     |

Future dedicated packages and product applications follow `IMPLEMENTATION_PLAN.md`.
Service validation and permissions currently live in `engine`; there are no placeholder package APIs.

Core hardening and its verified boundaries are documented in [CORE_SECURITY.md](./docs/CORE_SECURITY.md).
The 0.2 licensing upgrade is preserved in 0.3. Pending real-server/code-signing release requirements are documented in [ONLINE_LICENSING.md](./docs/ONLINE_LICENSING.md). The current installer is for review until the actual HTTPS authority is configured. The 0.3 interface adds two-step first setup, confirmed passwords, coherent navigation/icons, useful dashboard actions, keyboard help and responsive layouts; see [INTERFACE_REFRESH.md](./docs/INTERFACE_REFRESH.md).
The core is usable in Node 22+ and isolated browser renderers. `CostBasis` preserves original
inventory value across partial consumption; rounded unit prices must not be used as its replacement.
Numeric input uses an explicit decimal-separator policy, and client errors use `toClientJSON()`.

Barcode reference selection, scanner setup, scale configuration and integration boundaries are
documented in [BARCODE_ENGINE.md](./docs/BARCODE_ENGINE.md). No reference code or assets were copied.
The package stays independent of the catalog. POS integrates checked lookup, keyboard scanning,
configured scale weight decoding, transactional stock changes and Canvas label printing.

## Non-negotiable conventions

These exist because the suite handles other people's money.

- **Money is integer piastres.** Never a float, never `REAL` in SQLite. All arithmetic goes through
  `Money`; splits use `Money.allocate`/`Money.split` so parts always re-sum exactly.
- **Quantity is integer milli-units** (3 decimal places).
- **`packages/domain` performs no I/O.** It imports `core` only — no database, Electron or React.
- **Permissions are enforced in services**, never by hiding UI.
- **Documents are atomic and idempotent**: one transaction, one `client_txn_id`.
- **Ledgers are append-only**: corrections are reversing entries, not updates.
