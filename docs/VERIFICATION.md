# Verification scope

## Recorded pre-publication baseline

On 22 October 2026, the source baseline corresponding to commit `c50531c7ab8df9d501c57ab9f451eb43ed878095` passed both TypeScript stages and **696 tests in 109 files** on the maintainer's Windows environment. The source-copy verification matched the repository files to that tested baseline.

The first restricted-environment run had two loopback-listener permission failures; rerunning with local networking available passed the full suite. No test was removed or skipped to hide those failures.

This is a dated local result. It does not certify hardware compatibility, encryption at rest, deployment security, payment integration or clinical/statutory suitability. It is not an independent audit. Later checks must be evaluated for their own commit.

## Reproduce checks

A second full local verification on 22 October 2026 used the newly installed public checkout, Node 24.19.0 and pnpm 10.12.1 after the quota-test correction described below. Both TypeScript stages, all 696 tests in 109 files, and the executable money example passed. Dependencies were installed from the lockfile with `--ignore-scripts`; the bundled SQLite and esbuild binaries were exercised successfully. This does not substitute for the remote CI result.

Follow [GETTING_STARTED.md](GETTING_STARTED.md), then run:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
node examples/core-money.mjs
```

The [Windows workflow](../.github/workflows/verify.yml) repeats these checks on pushes and pull requests. Its live result is available in [GitHub Actions](https://github.com/yousefbadran6888-ux/xzare-business-engine/actions/workflows/verify.yml); the existence of a workflow file alone is not a passing run.

Public-source preparation adds documentation, license metadata, the executable core example and missing workspace entries in the lockfile. A fresh-install run exposed a pre-existing flaky quota test: its frozen clock gives all activations the same timestamp, so registration order cannot determine the first returned device. The assertion now checks every registered device's exact public fields without assuming insertion order, retaining quota and sensitive-field checks. Runtime licensing behavior is unchanged. This work does not claim new runtime security features or an implemented eighteenth product.
