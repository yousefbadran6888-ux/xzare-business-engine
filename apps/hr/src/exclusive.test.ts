import { it, expect } from 'vitest'
import { exclusive } from './exclusive'
it('allows only one restore/upload or file dialog while the first is unresolved', async () => {
  const lock = { current: false }
  const busy: boolean[] = []
  let finish!: () => void
  const pending = new Promise<void>((r) => (finish = r))
  let dialogs = 0
  const first = exclusive(
    lock,
    (x) => busy.push(x),
    async () => {
      dialogs++
      await pending
      return 'restored'
    },
  )
  await expect(
    exclusive(
      lock,
      (x) => busy.push(x),
      async () => {
        dialogs++
        return 'duplicate'
      },
    ),
  ).rejects.toThrow()
  expect(dialogs).toBe(1)
  finish()
  expect(await first).toBe('restored')
  expect(lock.current).toBe(false)
  expect(busy).toEqual([true, false])
})
it('releases the restore lock on cancellation/failure so a new attempt can run', async () => {
  const lock = { current: false }
  await expect(
    exclusive(
      lock,
      () => {},
      async () => {
        throw new Error('QA cancel')
      },
    ),
  ).rejects.toThrow('QA cancel')
  expect(
    await exclusive(
      lock,
      () => {},
      async () => 42,
    ),
  ).toBe(42)
})
