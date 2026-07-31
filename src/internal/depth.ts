/**
 * Bounds on how deep a config tree may go, and the words for saying so.
 *
 * Two different limits live here because two different things can be too deep.
 *
 * {@link MAX_PATH_SEGMENTS} bounds a *name* that maps to a path — an
 * environment variable's `__` segments, a Properties file's dotted key. One
 * name produces one arbitrarily deep chain, so the input needed to exhaust the
 * stack is tiny: a single long string, no structure required. rs.hocon and
 * py.hocon cap the same mapping at 64, and this repeats that number so a name
 * that mounts in one implementation mounts in the other.
 *
 * Deeply nested *documents* get no such cap: refusing a 65-level JSON document
 * would be a claim about the format, not about a name we invented a mapping
 * for. They get {@link guardStackDepth} instead, which turns the engine's
 * `RangeError` into whichever error the calling entry point's contract names —
 * `ParseError` from `parse`, `ConfigError` from `fromMap` and the adapters. The
 * guard takes that as a parameter rather than choosing, because the two entry
 * points document different types and neither should inherit the other's.
 *
 * That matters beyond tidiness — the depth at which V8 gives out depends on how
 * deep the *caller* already is, so the same document can parse from one call
 * site and throw from another, and neither outcome should be an error type the
 * documented `catch` misses.
 */

import { ConfigError } from '../errors.js'

/**
 * Ceiling on the number of path segments one name may map to (F1.2 for env,
 * S23.x for Properties). Matches rs.hocon's and py.hocon's limit.
 */
export const MAX_PATH_SEGMENTS = 64

/** Whether a mapped path is over {@link MAX_PATH_SEGMENTS}. */
export function tooDeep(segments: number): boolean {
  return segments > MAX_PATH_SEGMENTS
}

/**
 * Run `fn`, turning a `RangeError` from stack exhaustion into `wrap(message)`.
 *
 * The message names the possibilities rather than asserting one, because from
 * inside the handler they are indistinguishable: input nested past what the
 * engine's stack holds, a *cyclic* input structure (an object that contains
 * itself, handed to `fromMap`), or — least likely — a cycle in this library.
 * Naming only depth would send a reader looking for nesting that is not there.
 *
 * Only stack-exhaustion `RangeError`s are converted. A `RangeError` thrown for
 * any other reason is rethrown untouched, so a genuine range bug is not
 * relabelled as a depth problem.
 */
export function guardStackDepth<T>(fn: () => T, wrap: (message: string) => Error): T {
  try {
    return fn()
  } catch (e) {
    if (!isStackOverflow(e)) throw e
    throw wrap(STACK_MESSAGE)
  }
}

const STACK_MESSAGE =
  "input is nested too deeply for this engine's stack, or contains a cycle " +
  '(flatten the document, or break the cycle)'

/**
 * V8, JavaScriptCore and SpiderMonkey all report stack exhaustion as a
 * `RangeError`, with three different messages — so the message is matched
 * loosely and the type is what actually gates. `RangeError` from any other
 * cause (`toFixed(101)`, an invalid array length) keeps its own identity.
 */
function isStackOverflow(e: unknown): boolean {
  if (!(e instanceof RangeError)) return false
  const m = e.message.toLowerCase()
  return (
    m.includes('call stack') || // V8: "Maximum call stack size exceeded"
    m.includes('recursion') || // SpiderMonkey: "too much recursion"
    m.includes('stack overflow') // JavaScriptCore
  )
}

/** The `ConfigError` shape the adapters and the value factory both want. */
export function depthError(message: string): ConfigError {
  return new ConfigError(message, '')
}

/**
 * {@link guardStackDepth} for a promise-returning `fn`.
 *
 * The `await` sits inside the `try` deliberately: the async parse path can
 * exhaust the stack either synchronously, before it yields, or in a
 * continuation after an `await`, and only awaiting inside catches both. A bare
 * `try { return fn() }` would return the rejected promise untouched.
 */
export async function guardStackDepthAsync<T>(
  fn: () => Promise<T>,
  wrap: (message: string) => Error,
): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (!isStackOverflow(e)) throw e
    throw wrap(STACK_MESSAGE)
  }
}
