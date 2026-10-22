// SPDX-License-Identifier: AGPL-3.0-only
// Run after pnpm build: node examples/core-money.mjs
import assert from 'node:assert/strict'
import { Money } from '../packages/core/dist/index.js'

const amount = Money.parse('١٢٣٤٫٥٠')
if (!amount.ok) throw amount.error
assert.equal(Money.toPiastres(amount.value), 123450)
console.log('Arabic amount in piastres:', Money.toPiastres(amount.value))
console.log('Exact decimal amount:', Money.toDecimalString(amount.value))

const total = Money.fromPiastres(100)
const parts = Money.allocate(total, [1, 1, 1])
assert.deepEqual(parts.map(Money.toPiastres), [34, 33, 33])
assert.equal(Money.sum(parts), total)
console.log('One pound split three ways:', parts.map(Money.toPiastres))
console.log('Reconciled total:', Money.toDecimalString(Money.sum(parts)))
