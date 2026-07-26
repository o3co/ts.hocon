// Copyright 2026 1o1 Co. Ltd.
// SPDX-License-Identifier: Apache-2.0
//
// tests/docs.test.ts
// The README states facts that go stale on their own: the compliance rates, the
// minimum Node version, and "unreleased" markers left behind after the release
// that shipped the behavior. Nothing else exercises them, so they only ever
// drift in one direction. These tests recompute each from the artifact that
// actually decides it — docs/spec-compliance.md and package.json — and run in
// the release workflow, so a stale README fails the cut.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const read = (relative: string): string => readFileSync(join(repoRoot, relative), 'utf8')

/**
 * Number of S-items in the shared spec checklist
 * (xx.hocon/docs/spec-checklist.md). Both compliance rates use it as the
 * denominator, so a per-impl doc that drifted away from the checklist would
 * silently change the rates; the count is asserted rather than derived.
 */
const SPEC_ITEM_TOTAL = 210

// An S-item heading: "- **S13a.10** Some rule — §Section (L123)". E-items
// (extra-spec conventions) use the same block shape but are not part of the
// checklist, so the heading pattern is what separates them.
const SPEC_ITEM_HEAD = /^\s*- \*\*(S[0-9A-Za-z._]+)\*\*/
const OTHER_HEAD = /^\s*- \*\*[0-9A-Za-z._]+\*\*/
const STATUS_LINE = /^\s*status:/

interface ComplianceCounts {
  pass: number
  partial: number
  fail: number
  unverified: number
  outOfScope: number
}

/**
 * Tallies the status glyph of every S-item block in docs/spec-compliance.md.
 * Only the first `status:` line after an S-item heading counts: a block may
 * carry sub-bullets, and the E-item blocks that follow the S-items must not be
 * picked up.
 */
function countCompliance(): ComplianceCounts {
  const counts: ComplianceCounts = { pass: 0, partial: 0, fail: 0, unverified: 0, outOfScope: 0 }
  let inSpecItem = false

  for (const line of read('docs/spec-compliance.md').split('\n')) {
    if (SPEC_ITEM_HEAD.test(line)) {
      inSpecItem = true
    } else if (OTHER_HEAD.test(line)) {
      inSpecItem = false
    } else if (inSpecItem && STATUS_LINE.test(line)) {
      inSpecItem = false
      if (line.includes('✅')) counts.pass++
      else if (line.includes('⚠️')) counts.partial++
      else if (line.includes('❌')) counts.fail++
      else if (line.includes('🤷')) counts.unverified++
      else if (line.includes('➖')) counts.outOfScope++
      else throw new Error(`status line carries no known glyph: ${line.trim()}`)
    }
  }
  return counts
}

const total = (c: ComplianceCounts): number =>
  c.pass + c.partial + c.fail + c.unverified + c.outOfScope

/** Rate to one decimal, matching how the README writes it. */
const rate = (c: ComplianceCounts, denominator: number): string =>
  (((c.pass + c.partial * 0.5) / denominator) * 100).toFixed(1)

/**
 * Returns the single capture group of `re`, throwing when the pattern no longer
 * matches — a README rewrite that drops the claim must fail loudly rather than
 * silently stop checking it.
 */
function findOne(text: string, re: RegExp, what: string): string {
  const m = re.exec(text)
  if (m === null) {
    throw new Error(`${what} not found (pattern ${re}); update the pattern if the doc was restructured`)
  }
  return m[1]!
}

describe('docs consistency', () => {
  it('docs/spec-compliance.md covers every checklist item', () => {
    const counts = countCompliance()
    expect(
      total(counts),
      'an item was added, dropped, or its status line is malformed',
    ).toBe(SPEC_ITEM_TOTAL)
    expect(counts.unverified, 'every item must be pinned by a test').toBe(0)
  })

  it('README compliance rates match docs/spec-compliance.md', () => {
    const counts = countCompliance()
    const readme = read('README.md')

    const specTotal = findOne(
      readme,
      /\| Spec total \(incl\. out-of-scope\) +\| \*\*([0-9.]+)%\*\* +\|/,
      'spec-total compliance rate',
    )
    const inScope = findOne(
      readme,
      /\| In-scope only +\| \*\*([0-9.]+)%\*\* +\|/,
      'in-scope compliance rate',
    )

    expect(specTotal).toBe(rate(counts, SPEC_ITEM_TOTAL))
    expect(inScope).toBe(rate(counts, SPEC_ITEM_TOTAL - counts.outOfScope))
  })

  it('README minimum Node version matches package.json engines', () => {
    const engines = findOne(
      read('package.json'),
      /"node": ">=(\d+)"/,
      'engines.node',
    )
    const claimed = findOne(
      read('README.md'),
      /Requires Node\.js (\d+)\+/,
      'minimum Node version',
    )
    expect(claimed, 'a user on the version the README names cannot install this package').toBe(engines)
  })

  it('README does not mark shipped behavior as unreleased', () => {
    const offenders = read('README.md')
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => line.includes('(Unreleased)'))
      .map(([n, line]) => `README.md:${n}: ${line.trim()}`)
    expect(offenders).toEqual([])
  })
})
