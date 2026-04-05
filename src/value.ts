// JavaScript の Map は挿入順を保証するため keys フィールド不要
export type ScalarValueType = 'string' | 'number' | 'boolean' | 'null'

export type HoconValue =
  | { kind: 'object'; fields: Map<string, HoconValue> }
  | { kind: 'array'; items: HoconValue[] }
  | { kind: 'scalar'; raw: string; valueType: ScalarValueType }
