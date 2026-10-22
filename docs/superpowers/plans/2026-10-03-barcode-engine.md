# Shared Barcode Engine Implementation Plan

Goal: implement reusable barcode interpretation and scanner framing informed by the four local references, using original TypeScript code.

Architecture: @xzare/barcode depends only on @xzare/core. Identity validation, scale profiles and scanner framing are separate files. Product lookup, authorization, stock transactions and printing remain application/infrastructure responsibilities.

Constraints: Node >=22, pnpm >=10, strict TypeScript, platform APIs only; no reference code or assets copied; preserve barcode strings and leading zeros; no float amounts; no random global GTIN assignment; do not alter E:\مصدر.

## Tasks

- [x] Create package manifest, project reference and Vitest alias; add failing tests for Barcode.parse and gs1CheckDigit. Cases: known GTINs, UPC leading zero, invalid checksums, controls, oversized inputs and injection strings.
- [x] Implement strict EAN8/EAN13/UPCA/GTIN14/CODE128 identity validation and GS1 modulo-10 check digit. `Barcode.parse(input: unknown, format: unknown): Result<Barcode>`; `gs1CheckDigit(payload: unknown): Result<string>`.
- [x] Add failing tests for `ScaleBarcodeCodec.create(profiles: unknown)` and `.decode(input: unknown)`. Profile fields: id, prefix, productDigits, valueDigits, kind (weight/price), decimals; lengths sum to 12 before check digit. Reject invalid or overlapping prefixes, zero value and invalid check digits. Return original code, profile id, product code and branded Quantity or Money without floating point.
- [x] Implement immutable checked profiles; encode valid product codes and positive exact branded values as reversible scale labels. Price profiles always use the core's two decimal minor-unit precision; weight profiles support 0–3 decimals and refuse unrepresentable values.
- [x] Add failing tests and implement `KeyboardScanBuffer`: dedicated-focus activation, Enter/CR/LF completion, maximum 64 characters, timeout and invalid-frame discard, composition/modifier/repeat exclusion, no timer-based human/scanner guessing or barcode-content deduplication.
- [x] Document reference comparisons and concrete USB-HID, scale and label workflow with explicit integration boundaries. Review independently; run `pnpm verify`, targeted Prettier check and `git diff --check`.

Review correction: `encode` accepts discriminated `ScaleAmount`, snapshots own data descriptors and rejects contradictory fields/accessors. `push` accepts `unknown` at the runtime boundary and invalidates malformed frames. Final verification: 285 tests, 17 files, build and source/test typechecks pass; 67 tests cover barcode behavior and isolated renderer execution.

Fixtures are tests only; no seeded business products, prices or credentials are introduced.
