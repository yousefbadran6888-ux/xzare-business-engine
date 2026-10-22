import { it, expect, vi } from 'vitest'
import { commitThenRefresh } from './commit-refresh'
it('acknowledges a committed financial operation even if its following read fails', async () => {
  let ledger = 0
  const commit = vi.fn(async () => {
      ledger++
      return { id: 'committed' }
    }),
    refresh = vi.fn(async () => {
      throw new Error('read unavailable')
    }),
    stale = vi.fn()
  await expect(commitThenRefresh(commit, refresh, stale)).resolves.toEqual({ id: 'committed' })
  expect(ledger).toBe(1)
  expect(commit).toHaveBeenCalledTimes(1)
  expect(stale).toHaveBeenCalledOnce()
})
it('keeps an uncommitted operation retryable when its write fails and performs no refresh', async () => {
  const commit = async () => {
      throw new Error('write rejected')
    },
    refresh = vi.fn(),
    stale = vi.fn()
  await expect(commitThenRefresh(commit, refresh, stale)).rejects.toThrow('write rejected')
  expect(refresh).not.toHaveBeenCalled()
  expect(stale).not.toHaveBeenCalled()
})
