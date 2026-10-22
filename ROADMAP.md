# Roadmap and current boundaries

This is a development roadmap, not a list of promised delivery dates.

## Present in source

- Four shared packages: core primitives, SQLite infrastructure, barcode handling and business services.
- Seventeen application sources: POS, Restaurant, Accounting, Inventory, Manufacturing, Workshop, Service Center, Clinic, Laboratory, Pharmacy, HR, CRM, Education, Gym, Salon, Hotel and Real Estate.
- Existing TypeScript and Vitest checks, plus operating and security documentation.

## Near-term priorities

1. Make fresh-checkout setup reproducible and keep Windows CI passing.
2. Gather real, consented feedback from developers using synthetic data first; record reproducible problems in issues.
3. Improve Arabic/English onboarding and small examples for shared packages.
4. Test actual scanner/printer compatibility and backup/restore failure paths before distribution claims.
5. Review dependency updates and security reports, keeping source and third-party notices intact.

## Planned implementation

Product 18, Property Manager, currently has a [design specification](docs/superpowers/specs/2026-10-10-property-manager-design.md). It is not an implemented eighteenth application. Products 19–30 are planned workflows in the [portfolio](docs/PRODUCT_PORTFOLIO.md).

Portable database adapters, broader currency support and Linux/macOS desktop support need explicit design and verification; they are not current compatibility promises. Historical architecture plans describe future packages that may not exist yet.

## Before customer deployment

Production activation hosting, publisher signing, device testing and business-specific acceptance are independent of publishing the source. Healthcare or statutory financial use requires appropriate domain validation. No delivery date or certification is implied.
