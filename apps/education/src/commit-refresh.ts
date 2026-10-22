export async function commitThenRefresh<T>(
  commit: () => Promise<T>,
  refresh: () => Promise<unknown>,
  stale: (e: unknown) => void,
) {
  const result = await commit()
  try {
    await refresh()
  } catch (e) {
    stale(e)
  }
  return result
}
