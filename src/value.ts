// JavaScript の Map は挿入順を保証するため keys フィールド不要
export type HoconValue =
  | { kind: 'object'; fields: Map<string, HoconValue> }
  | { kind: 'array'; items: HoconValue[] }
  | { kind: 'scalar'; value: string | number | boolean | null }
