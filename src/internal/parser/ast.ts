export type Pos = { line: number; col: number; file?: string }

export type AstNode =
  | { kind: 'object'; fields: AstField[]; pos: Pos }
  | { kind: 'array'; items: AstNode[]; pos: Pos }
  | { kind: 'scalar'; value: string | number | boolean | null; pos: Pos }
  | { kind: 'concat'; nodes: AstNode[]; pos: Pos }
  | { kind: 'subst'; path: string; optional: boolean; pos: Pos }
  | { kind: 'include'; path: string; pos: Pos }

// key が空配列のとき include ディレクティブを表す（value は include ノード）
export type AstField = {
  key: string[]     // 各要素はドット分割済み。quoted キーはドット分割しない
  value: AstNode
  append: boolean   // true なら += 演算子
  pos: Pos
}
