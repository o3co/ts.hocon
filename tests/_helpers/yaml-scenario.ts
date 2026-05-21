// Copyright 2026 1o1 Co. Ltd.
// SPDX-License-Identifier: Apache-2.0
//
// tests/_helpers/yaml-scenario.ts
// TypeScript types for the deferred-resolution YAML scenario schema.
// See tests/lightbend/testdata/hocon/deferred-resolution/README.md for schema docs.

// ── Source definitions ────────────────────────────────────────────────────────

export interface ParseSourceOptions {
  resolveSubstitutions?: boolean
  originDescription?: string
}

export interface ParseStringSource {
  parseString: string
  parseOptions?: ParseSourceOptions
}

export interface FromMapSource {
  fromMap: Record<string, unknown>
}

export type Source = ParseStringSource | FromMapSource

export interface ScenarioSources {
  [alias: string]: Source
}

// ── Build operations ──────────────────────────────────────────────────────────

export type BuildOp =
  | { op: 'take'; source: string; as: string }
  | { op: 'withFallback'; this: string; other: string; as: string }
  | { op: 'resolve'; this: string; allowUnresolved?: boolean; useSystemEnvironment?: boolean; as: string }
  | { op: 'resolveWith'; this: string; source: string; allowUnresolved?: boolean; useSystemEnvironment?: boolean; as: string }
  | { op: 'extract'; this: string; path: string; as: string }

// ── Getter assertions ─────────────────────────────────────────────────────────

export interface GetterAssert {
  path: string
  expectString?: string
  expectInt?: number
  expectFloat?: number
  expectBoolean?: boolean
  expectNull?: boolean
  expectArray?: unknown[]
  expectError?: 'NotResolved' | 'Missing' | 'WrongType'
}

// ── Expect block ──────────────────────────────────────────────────────────────

export interface ScenarioExpect {
  outcome: 'success' | 'error'
  isResolved?: boolean
  json?: string
  getter?: GetterAssert[]
  errorAt?: number
  errorCategory?: 'ResolveError' | 'TypeError' | 'ParseError' | 'NotResolved'
  errorContains?: string
}

// ── Top-level scenario ────────────────────────────────────────────────────────

export interface Scenario {
  description: string
  xref?: string[]
  lightbendSkip?: boolean
  sources: ScenarioSources
  build: BuildOp[]
  expect: ScenarioExpect
}
