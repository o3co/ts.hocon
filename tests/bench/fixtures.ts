// tests/bench/fixtures.ts

type FixturePair = { hocon: string; json: string }

/**
 * Generate a flat/nested config with the given number of keys.
 * Produces equivalent HOCON and JSON strings.
 */
export function generateConfig(size: 'small' | 'medium' | 'large'): FixturePair {
  const specs = { small: { keys: 10, depth: 2 }, medium: { keys: 100, depth: 4 }, large: { keys: 1000, depth: 6 } }
  const { keys, depth } = specs[size]
  return buildNestedConfig(keys, depth)
}

/**
 * Generate a config with substitutions. HOCON uses ${ref}, JSON resolves inline.
 * Returns only HOCON (JSON has no substitution equivalent).
 */
export function generateWithSubstitutions(count: number, baseKeys?: number): { hocon: string } {
  const total = baseKeys ?? count * 2
  const lines: string[] = []

  // Base keys
  for (let i = 0; i < total; i++) {
    lines.push(`base${i} = "value${i}"`)
  }

  // Substitution keys referencing base keys
  for (let i = 0; i < count; i++) {
    lines.push(`sub${i} = \${base${i % total}}`)
  }

  return { hocon: lines.join('\n') }
}

/**
 * Generate a deeply nested config. Produces equivalent HOCON and JSON.
 */
export function generateDeepNested(depth: number): FixturePair {
  return buildDeepConfig(depth)
}

function buildNestedConfig(totalKeys: number, maxDepth: number): FixturePair {
  const obj: Record<string, unknown> = {}
  const hoconLines: string[] = []
  const keysPerGroup = Math.max(1, Math.floor(totalKeys / maxDepth))

  for (let d = 0; d < maxDepth; d++) {
    const groupKey = `group${d}`
    const inner: Record<string, unknown> = {}
    const innerLines: string[] = []

    const count = d < maxDepth - 1 ? keysPerGroup : totalKeys - keysPerGroup * (maxDepth - 1)
    for (let i = 0; i < count; i++) {
      inner[`key${i}`] = `value${d}_${i}`
      innerLines.push(`  key${i} = "value${d}_${i}"`)
    }

    obj[groupKey] = inner
    hoconLines.push(`${groupKey} {`)
    hoconLines.push(...innerLines)
    hoconLines.push('}')
  }

  return { hocon: hoconLines.join('\n'), json: JSON.stringify(obj) }
}

function buildDeepConfig(depth: number): FixturePair {
  // Build from inside out
  let innerObj: Record<string, unknown> = {}
  for (let i = 0; i < 5; i++) {
    innerObj[`key${i}`] = `deep_value${i}`
  }

  let hoconInner = ''
  for (let i = 0; i < 5; i++) {
    hoconInner += `  key${i} = "deep_value${i}"\n`
  }

  for (let d = depth - 1; d >= 0; d--) {
    const key = `level${d}`
    innerObj = { [key]: innerObj }
    hoconInner = `${key} {\n${hoconInner}}\n`
  }

  return { hocon: hoconInner, json: JSON.stringify(innerObj) }
}

/**
 * Pre-generated fixtures for benchmark use.
 */
export const fixtures = {
  small: generateConfig('small'),
  medium: generateConfig('medium'),
  large: generateConfig('large'),
  substitutions10: generateWithSubstitutions(10),
  substitutions50: generateWithSubstitutions(50),
  substitutions100: generateWithSubstitutions(100),
  deepNest5: generateDeepNested(5),
  deepNest10: generateDeepNested(10),
  deepNest20: generateDeepNested(20),
}
