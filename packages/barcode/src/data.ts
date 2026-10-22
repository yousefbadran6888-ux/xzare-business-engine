/** Snapshots small plain-data inputs; never invokes getters, toJSON or iterators. */
export function readData(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof value !== 'object' || value === null) return null
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype) return null
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (
      keys.some(
        (key) => typeof key !== 'string' || (!required.includes(key) && !optional.includes(key)),
      )
    )
      return null
    const data: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const field of [...required, ...optional]) {
      const descriptor = descriptors[field]
      if (!descriptor) {
        if (required.includes(field)) return null
        continue
      }
      if (!Object.hasOwn(descriptor, 'value')) return null
      data[field] = descriptor.value
    }
    return Object.freeze(data)
  } catch {
    return null
  }
}
