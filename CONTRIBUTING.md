# Contributing to Xzare

Arabic and English contributions are welcome. Start with [the setup guide](docs/GETTING_STARTED.md) and [current roadmap](ROADMAP.md). Small, reviewable changes are easier to maintain than large unrelated rewrites.

## Report a problem

Search existing issues, then include the commit/version, Windows and Node versions, exact reproduction steps, expected result and actual result. Use a minimal synthetic example. Remove customer names, patient records, credentials, licenses and database exports. Report vulnerabilities privately using [SECURITY.md](SECURITY.md), not in a public issue.

## Propose a change

1. Open an issue for a substantial behavior or architecture change before implementing it. Documentation corrections and focused bug fixes may go straight to a pull request.
2. Fork the repository and create a branch for one change.
3. Install with `pnpm install --frozen-lockfile --ignore-scripts` using the documented Windows environment.
4. Add a meaningful regression test for changed business behavior. Documentation-only edits do not need artificial tests.
5. Run `pnpm verify` and `node examples/core-money.mjs`. Report the actual results, including failures or checks you could not run.
6. Open a pull request explaining the problem, change, verification and any migration or compatibility impact.

Do not commit generated output, dependencies, real databases, private keys, installers or personal data. Keep dependency changes focused and update the lockfile with pnpm 10.12.1. Do not disable security checks merely to make a test pass.

## Engineering invariants

- Money is integer piastres; quantities are scaled integers. Use checked constructors and allocation helpers.
- Service methods enforce authorization. A hidden button is not an access control.
- Business transactions must preserve atomicity and idempotency; test retry and failure paths where relevant.
- Ledger corrections use explicit reversing operations, not silent rewriting of history.
- Barcode identities are data, not authentication credentials.
- Keep the core independent of Electron, React and database I/O.

## Suggested first contributions

These are proposed tasks, not claims that someone has committed to deliver them:

- Improve a specific Arabic/English explanation using the existing behavior as evidence.
- Add a regression case for an unsupported or ambiguous numeric input, explaining the intended policy.
- Document a real scanner/printer compatibility test using synthetic labels and exact model/settings.
- Review error messages for missing context without exposing credentials or personal information.

AI-assisted contributions are acceptable when the contributor understands and checks the result. Describe substantial AI assistance in the PR; never submit invented test results or unattributed third-party code.

## Review and license

The maintainer reviews correctness, source provenance, tests and compatibility before merging. No response-time or acceptance guarantee is offered. The current project has one listed maintainer; see [MAINTAINERS.md](MAINTAINERS.md).

Contributions are accepted under the project's AGPL-3.0-only license unless an existing third-party license applies. Submit only work you have the right to contribute. No copyright assignment is required by this contribution guide. Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
