import type { HoconValue } from '../../value.js'
import type { AstNode } from '../parser/ast.js'
import { StructureBuilder } from './structure-builder.js'
import { SubstitutionResolver } from './substitution-resolver.js'
import type { ResolveOptions } from './types.js'

export type { ResolveOptions } from './types.js'

export function resolve(ast: AstNode, opts: ResolveOptions): HoconValue {
  const root = new StructureBuilder(opts).build(ast)
  return new SubstitutionResolver(root, opts).resolve()
}

export async function resolveAsync(
  ast: AstNode,
  opts: ResolveOptions,
): Promise<HoconValue> {
  const root = await new StructureBuilder(opts).buildAsync(ast)
  return new SubstitutionResolver(root, opts).resolve()
}
