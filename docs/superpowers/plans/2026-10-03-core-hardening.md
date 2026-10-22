# Core hardening implementation plan

**Goal:** Fix the issues reproduced in the core review and strengthen the existing foundation without claiming unimplemented application security.

**Architecture:** Keep the shared core portable and dependency-free. Validate text and transport objects at runtime, bound expensive parsing/logging, preserve exact financial totals, and use the platform cryptographic random generator for identifiers.

**Tech Stack:** TypeScript, Vitest, pnpm, Web Crypto. No added runtime dependencies.

The user authorized the review's repair recommendations on 2026-10-03. Execute inline in the existing checkout, preserving the pre-existing db/workspace changes. No new product apps, authentication system, or database implementation is included in this repair.

- [x] Numeric boundaries: add regression tests first; enforce explicit decimal separator and valid grouping, bounded input/scale, signed rounding, safe-integer validation Results, and currency tokens only at numeric boundaries.
- [x] Transport/logging: add regression tests first; validate serialized error fields and plain data descriptors, separate client error payloads from diagnostics, redact errors and causes, avoid invoking getters/toJSON, bound traversal/text, and prevent prototype-key handling from changing output prototypes.
- [x] IDs/portability: add regression tests first; enforce ULID timestamp bounds, use Web Crypto without a Node import, and verify a browser build of the public entry point.
- [x] Cost preservation: add tests first; provide cumulative inventory-cost allocation that retains original total and handles partial consumption without losing rounding remainders. Mark rounded unit prices as display/pricing only.
- [x] Verify sources and tests, run all tests, format changed files, obtain an independent review, resolve material findings, and document actual protections and remaining deployment gates.

Acceptance examples: `0,750` rejected by default and parsed as 0.750 only with comma mode; `1,2` rejected by default; negative FLOOR(-1.235) produces -1.24; oversized Money/Quantity input returns validation errors; a password on an Error cause never reaches the sink; forged transport markers rejected; browser bundle contains no Node dependency; allocating a 1.00 inventory cost across three units retains the final piastre.

Verified 2026-10-03: `pnpm verify` passed source/test typechecking, build and 218 tests across 13 files. Changed files pass Prettier and `git diff --check`. Independent review identified JSON-text secret scrubbing, unsafe client parameter handling, and redaction expansion past the text limit; all were reproduced by failing regression tests and fixed. No new runtime dependencies. See `docs/CORE_SECURITY.md` for implemented controls and the remaining application-level security gates.
