# Core security and correctness — implemented boundaries

Updated 2026-10-03. This describes the existing library, not an application penetration-test result. No percentage probability of compromise has been measured or promised.

## Numeric input

`Money.parse`, `Quantity.parse`, and `parseScaled` accept unknown runtime input and reject non-text values. Numeric text is limited to 256 characters. Decimal scales are integers from 0 to 18. Unsafe Money/Quantity amounts return validation Results; internal arithmetic overflow still throws as a programming/invariant failure.

The default ASCII decimal separator is `.`. Thousands groups must be valid groups of three using a single separator; mixed/malformed groups are rejected. Arabic digits, the Arabic decimal separator, and valid Arabic thousands groups remain supported. `0,750` is rejected in default mode. For a known comma-decimal import/input format:

```ts
Quantity.parse('0,750', { decimalSeparator: ',' }) // 0.750
Money.parse('12,50', { decimalSeparator: ',' }) // 12.50
```

Choose the policy in trusted application configuration, never guess it from individual values. Parentheses cannot be mixed with an explicit sign. Currency tokens are allowed once at a numeric boundary. Inputs and raw rejected values are not echoed in validation error parameters. Signed FLOOR/CEIL rounding is applied before removing the sign.

## Diagnostics and client errors

Use `XzareError.toClientJSON()` for IPC/client errors and `toUserFacing()` for translated UI messages. These omit internal message/details/stack/cause, and sanitize parameters. `toJSON()` is a diagnostic representation and must not be used as the renderer error contract. Message keys and parameters still need message-specific schemas when IPC is implemented.

Serialized errors are validated against the complete shape and supported code enum, with plain own data fields only. Unexpected/inherited/prototype keys, accessors, invalid numbers, nested parameter objects and oversized fields are rejected. Parameters are copied and frozen. Error normalization does not call arbitrary object toString or error accessors. Native V8 stack accessors are omitted; a safe diagnostic summary and the original cause are retained. An application may capture trusted diagnostic details explicitly before wrapping them.

The logger snapshots errors, causes and context with sensitive field redaction, including password/token/API-key/authorization/cookie variations. It does not invoke getters, toJSON, or custom iterators, and ignores prototype-changing keys. Cycles, binary data, revoked proxies, BigInt and unsupported objects are handled safely. Traversal is bounded by depth 6, 64 entries per container, 1000 node visits, 4096 characters per text value and a 16384-character aggregate text budget per sanitized object. MemoryLogSink retains 200 recent records by default, configurable from 1 to 10000.

Text scrubbing covers labelled credentials and Basic/Bearer authorization as a secondary measure. It cannot identify arbitrary unlabelled secrets or all encodings. Never put passwords, medical data, full payment data, raw request payloads, or credentials in free-form log messages. Use stable messages and deliberately selected structured fields. A log is not a database audit ledger; audit persistence must be transactional and must not silently discard failures.

## Portable identifiers

The public core entry point has no Node imports. ULIDs use platform Web Crypto, with no Math.random fallback. Node 22+ and an isolated browser runtime are tested. ULID validation rejects timestamps beyond the generator's 48-bit range. IDs are identifiers, not session secrets; ordering within one millisecond is not guaranteed.

## Exact inventory-cost allocation

`unitPriceFromTotal` remains a rounded price calculation. Use `CostBasis` for the original inventory value and cumulative consumption:

```ts
const initial = CostBasis.create(Money.fromPounds(1), Quantity.fromUnits(3))
const first = initial.take(Quantity.one) // 0.33, original object unchanged
const second = first.remaining.take(Quantity.one) // 0.34
const third = second.remaining.take(Quantity.one) // 0.33
```

The allocated values re-sum to 1.00. Persist `totalCost`, `totalQuantity`, and `consumedQuantity` as checked integers together in the stock transaction. Rehydrate with `CostBasis.restore`; invalid consumed quantities are rejected. Returns reverse the original recorded cost, rather than recomputing it using a new stock valuation. This primitive does not implement the inventory ledger, purchasing or persistence itself.

## Application security gates still required before selling

The repository now implements the Electron shell, rate-limited Argon2id authentication, service permissions, bounded allow-listed IPC, transactional SQLite/immutable ledgers, backup/validated restore and signed online licensing. Production packaging adds restrictive Electron fuses and Windows DPAPI device state. See [ONLINE_LICENSING.md](ONLINE_LICENSING.md) for the actual threat model, verified boundaries and pending live-server/Windows-signing gates. Normal Windows sandbox, physical hardware and update/power-failure acceptance still require external release testing. Keeping runtime dependencies patched and protecting the Windows user account and disk remain necessary.

No new runtime dependencies were introduced in this hardening. A dependency advisory audit and a packaged-application penetration test were not performed in this change.
