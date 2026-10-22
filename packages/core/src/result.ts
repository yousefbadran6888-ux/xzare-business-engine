/**
 * Explicit result type. Expected failures (validation, business rules, conflicts) are
 * returned as values rather than thrown, so that callers cannot ignore them by accident.
 * Genuine bugs still throw.
 */

import { XzareError } from './errors.js'

export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

export interface Err<E> {
  readonly ok: false
  readonly error: E
}

export type Result<T, E = XzareError> = Ok<T> | Err<E>

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok

/** Returns the value, or throws the error. Use only where failure is genuinely unexpected. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value
  throw result.error instanceof Error ? result.error : XzareError.from(result.error)
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error))
}

export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result
}

/** Collects many results into one; fails fast on the first error. */
export function collect<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = []
  for (const result of results) {
    if (!result.ok) return result
    values.push(result.value)
  }
  return ok(values)
}

/** Runs `fn`, converting any thrown value into an `Err<XzareError>`. */
export function attempt<T>(fn: () => T): Result<T, XzareError> {
  try {
    return ok(fn())
  } catch (cause) {
    return err(XzareError.from(cause))
  }
}
