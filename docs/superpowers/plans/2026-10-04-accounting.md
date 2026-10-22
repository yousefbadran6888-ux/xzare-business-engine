# Accounting Implementation Plan
> Execute inline with executing-plans; independent final code review.
Goal: deliver product #3 with real persisted double-entry accounting, distinct desktop UI, backup/license separation.
Architecture: accounting-schema.ts appended only to accounting DB; Accounting module independent of Commerce; Runtime routes common infrastructure and accounting actions. UI uses common secure auth/LicensePanel but custom accounting pages.
Stack: existing Node22, SQLite, Zod, TypeScript, React19, Vite7, Electron44.
Constraints: original D: not writable; work in this Documents source. No new dependency, copied private key, sample balances/default users, external publishing or live licensing bypass.
- [x] Test: unbalanced rollback, valid posting/retry, forbidden re-use, immutable ledger, correction, dates/closing, parent accounts, permissions, report reconciliation, backup/product boundaries.
- [x] Implement DB schema, validation/types, accounting operations/reports and runtime/backup/license product registration.
- [x] Implement actual chart/periods/draft editor/post/reverse, ledgers/trial/financial reports and CSV/print, users/settings/license.
- [x] Wire desktop/preview/build/package on separate accounting port/data and reuse safe icon system.
- [x] Verify suite/build, isolated UI workflow, independent review, packaged fuses/compiled modules, checksum/signature and operations docs.

Evidence: artifacts/accounting/REVIEW-STATUS.md; docs/ACCOUNTING.md; .cache/accounting-verify-final.log. HTTPS activation deployment and code signing remain explicit release requirements.
