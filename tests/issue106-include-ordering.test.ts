/**
 * Cross-impl regression tests for go.hocon#106 — include ordering and
 * self-referential append through include. The go.hocon fix changes its
 * include-merge logic; ts.hocon's `deepMergeResObjInto` (src wins + prior
 * capture) is already structured to match Lightbend semantics, so these
 * tests are expected to pass without changes. Pin them so future
 * refactors can't regress the behaviour silently.
 */
import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'

describe('go.hocon#106 cross-impl — include ordering + self-ref through include', () => {
  // Helper: parse with an in-memory file map injected via readFileSync.
  const buildParseWithFiles = (files: Map<string, string>) => {
    const readFileSync = (p: string) => {
      const content = files.get(p)
      if (content === undefined) {
        throw Object.assign(new Error(`enoent: ${p}`), { code: 'ENOENT' })
      }
      return content
    }
    return (input: string) => parse(input, { readFileSync })
  }

  it('include scalar overrides parent earlier value (Lightbend inline-equivalent semantics)', () => {
    const files = new Map<string, string>([
      ['/virtual/child.conf', 'a = 2\n'],
    ])
    const cfg = buildParseWithFiles(files)('a = 1\ninclude "/virtual/child.conf"\n')
    expect(cfg.getNumber('a')).toBe(2)
  })

  it('parent scalar after include overrides include (last write wins)', () => {
    const files = new Map<string, string>([
      ['/virtual/child.conf', 'a = 2\n'],
    ])
    const cfg = buildParseWithFiles(files)('include "/virtual/child.conf"\na = 5\n')
    expect(cfg.getNumber('a')).toBe(5)
  })

  it('self-referential append through include resolves against parent prior', () => {
    const files = new Map<string, string>([
      ['/virtual/child.conf', 'steps = ${steps} [\n  { name = child }\n]\n'],
    ])
    const cfg = buildParseWithFiles(files)(
      'steps = [\n  { name = base }\n]\n\ninclude "/virtual/child.conf"\n',
    )
    const steps = cfg.getList('steps')
    expect(steps).toHaveLength(2)
    expect((steps[0] as { name: string }).name).toBe('base')
    expect((steps[1] as { name: string }).name).toBe('child')
  })

  it('control: same-file self-referential append unchanged', () => {
    const cfg = parse(`steps = [
  { name = base }
]

steps = \${steps} [
  { name = child }
]
`)
    const steps = cfg.getList('steps')
    expect(steps).toHaveLength(2)
  })

  it('object collision through include deep-merges (disjoint sub-keys union)', () => {
    const files = new Map<string, string>([
      ['/virtual/child.conf', 'server { port = 8080 }\n'],
    ])
    const cfg = buildParseWithFiles(files)('server { host = "localhost" }\ninclude "/virtual/child.conf"\n')
    expect(cfg.getString('server.host')).toBe('localhost')
    expect(cfg.getNumber('server.port')).toBe(8080)
  })

  it('nested include override must not leak to top-level priorValues', () => {
    // Mirror of the multi-agent-review regression scenario flagged on
    // go.hocon — nested include override should NOT leak the prior under
    // the bare leaf key into the resolver-wide scope. Otherwise an unrelated
    // top-level self-ref with the same leaf would incorrectly resolve to the
    // nested value.
    const files = new Map<string, string>([
      ['/virtual/leaf.conf', 'a = innerB\n'],
    ])
    const cfg = buildParseWithFiles(files)(`nested {
  a = innerA
  include "/virtual/leaf.conf"
}
a = \${?a}suffix
`)
    expect(cfg.getString('nested.a')).toBe('innerB')
    expect(cfg.getString('a')).toBe('suffix')
  })

  it('sequential includes each chain priors correctly (last wins)', () => {
    const files = new Map<string, string>([
      ['/virtual/c1.conf', 'a = 2\n'],
      ['/virtual/c2.conf', 'a = 3\n'],
    ])
    const cfg = buildParseWithFiles(files)('a = 1\ninclude "/virtual/c1.conf"\ninclude "/virtual/c2.conf"\n')
    expect(cfg.getNumber('a')).toBe(3)
  })
})
