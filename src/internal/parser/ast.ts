import type { ScalarValueType } from '../../value.js'
import type { Segment } from '../lexer/token.js'

export type Pos = { line: number; col: number; file?: string }

/**
 * Discriminated union of include qualifiers.
 * - `bare`: `include "path"` — resolves relative to including file's directory
 * - `file`: `include file("path")` — resolves relative to CWD (or as absolute)
 * - `package`: `include package("id", "file")` — resolves via Node module resolution
 */
export type IncludeQualifier =
  | { kind: 'bare' }
  | { kind: 'file' }
  | { kind: 'package'; identifier: string }

export type AstNode =
  | { kind: 'object'; fields: AstField[]; pos: Pos }
  | { kind: 'array'; items: AstNode[]; pos: Pos }
  | { kind: 'scalar'; raw: string; valueType: ScalarValueType; pos: Pos; _separator?: boolean }
  | { kind: 'concat'; nodes: AstNode[]; pos: Pos }
  | { kind: 'subst'; segments: Segment[]; optional: boolean; listSuffix: boolean; pos: Pos }
  | { kind: 'include'; qualifier: IncludeQualifier; path: string; required: boolean; pos: Pos }

// key が空配列のとき include ディレクティブを表す（value は include ノード）
export type AstField = {
  key: string[]     // 各要素はドット分割済み。quoted キーはドット分割しない
  value: AstNode
  append: boolean   // true なら += 演算子
  pos: Pos
}
