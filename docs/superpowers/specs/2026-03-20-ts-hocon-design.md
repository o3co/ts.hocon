# @o3co/ts.hocon — Design Spec

**Date:** 2026-03-20
**Status:** Approved

---

## Overview

`@o3co/ts.hocon` は TypeScript 製の HOCON パーサーライブラリ。
Go 実装 (`go.hocon`) の設計を踏襲しつつ、TypeScript イディオムに沿った公開 API を提供する。
Node.js をプライマリターゲットとし、ブラウザ互換も目指す。

---

## Goals

- HOCON 仕様への完全準拠（Lightbend 公式テストスイート通過）
- 同期 / 非同期 API の両提供
- ESM + CJS デュアルパッケージ
- Zod インテグレーション（オプション peer dependency）
- TypeScript strict モードで型安全に使えること

---

## Project Structure

```text
@o3co/ts.hocon/
├── src/
│   ├── index.ts              # public exports
│   ├── parse.ts              # parse / parseAsync / parseFile / parseFileAsync
│   ├── config.ts             # Config クラス
│   ├── value.ts              # HoconValue 判別共用体
│   ├── errors.ts             # ParseError / ResolveError / ConfigError
│   ├── zod.ts                # Zod インテグレーション（peer dep）
│   └── internal/
│       ├── lexer/
│       │   ├── lexer.ts
│       │   └── token.ts
│       ├── parser/
│       │   ├── parser.ts
│       │   └── ast.ts
│       └── resolver/
│           └── resolver.ts
├── tests/
│   ├── lightbend/            # Lightbend 公式テストスイート
│   ├── lexer.test.ts
│   ├── parser.test.ts
│   ├── resolver.test.ts
│   └── config.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Tooling

| 役割       | ツール                               |
| ---------- | ------------------------------------ |
| ビルド     | tsup（ESM + CJS デュアルパッケージ） |
| テスト     | Vitest                               |
| 型チェック | TypeScript strict                    |
| Zod        | peer dependency（オプション）        |

---

## Internal Architecture

### Pipeline

```text
文字列 / ファイル
    ↓ Lexer     → Token[]
    ↓ Parser    → AstNode（ObjectNode がルート）
    ↓ Resolver  → HoconValue（2パス）
    ↓ Config    → 公開 API
```

### AST 型（Parser 出力）

```ts
// src/internal/parser/ast.ts

type Pos = { line: number; col: number; file?: string }

type AstNode =
  | { kind: "object";  fields: AstField[]; pos: Pos }
  | { kind: "array";   items: AstNode[];   pos: Pos }
  | { kind: "scalar";  value: string | number | boolean | null; pos: Pos }
  | { kind: "concat";  nodes: AstNode[];   pos: Pos }
  | { kind: "subst";   path: string; optional: boolean; pos: Pos }
  | { kind: "include"; path: string; pos: Pos }

// key が空配列の場合は include ディレクティブを表す（Go の synthetic field と同じ意味）
type AstField = {
  key: string[]      // ドット記法を分割済み。quoted キーはドット分割しない
  value: AstNode
  append: boolean    // true なら += 演算子
  pos: Pos
}
```

**注意：quoted キーのドット分割**
`"a.b" = 1` のようにクォートされたキーはドット分割しない。
`key` 配列の各要素は、lexer が `isQuoted` フラグを付けた場合はそのままリテラルとして扱う。

### 解決済み値型（Resolver 出力）

```ts
// src/value.ts

// JavaScript の Map は挿入順を保証するため、keys[] フィールドは不要
type HoconValue =
  | { kind: "object"; fields: Map<string, HoconValue> }  // Map のイテレーション順 = 宣言順
  | { kind: "array";  items: HoconValue[] }
  | { kind: "scalar"; value: string | number | boolean | null }
```

**数値型の扱い：**
Go の `int64` / `float64` の区別は TypeScript では不要。
Lexer は整数リテラル → `number`、浮動小数点リテラル → `number` として扱う（両方 JS `number`）。
`1` と `1.0` は内部的に同じ値になる。`z.number().int()` は `Number.isInteger()` で判定される。

### Resolver：2パス解決

Go 版と同じアルゴリズム。

#### Pass 1：構造構築とマージ

```ts
// 内部センチネル型（src/internal/resolver/resolver.ts 内部のみ）
type SubstPlaceholder = {
  _kind: "subst-placeholder"
  path: string
  optional: boolean
  pos: Pos
}
type ConcatPlaceholder = {
  _kind: "concat-placeholder"
  nodes: (HoconValue | SubstPlaceholder | ConcatPlaceholder)[]
  pos: Pos
}
type ResolverValue = HoconValue | SubstPlaceholder | ConcatPlaceholder
```

- オブジェクト構造の構築・深マージ
- substitution ノード → `SubstPlaceholder`、concat ノード → `ConcatPlaceholder` として保持
- キーが上書きされるとき、`priorValues: Map<string, ResolverValue>` に上書き前の値を保存（自己参照 substitution 用）
- `priorValues` はオブジェクトスコープごとに管理する（Go 版と同じ）

#### Pass 2：代替解決

- `resolving: Set<string>` でサイクルを検出
- `${path}` → パスが見つからなければ `env[path]` にフォールバック（`process.env` または `ParseOptions.env`）
- `${?path}` → パスが見つからなければフィールドごと削除（エラーなし）
- 自己参照は `priorValues` を参照して解決
- `include` ディレクティブも pass 2 で解決し、深マージする

**include サイクル検出：**
`includeStack: string[]` でインクルードチェーンを追跡し、同一パスが2回現れたら `ResolveError` をスローする。

**`+=` 演算子：**
対象キーが存在しない場合は空配列 `[]` を初期値として扱う（Go 版と同じ）。

---

## Public API

### パース関数

```ts
// src/parse.ts

function parse(input: string, options?: ParseOptions): Config
function parseFile(path: string, options?: ParseOptions): Config
function parseAsync(input: string, options?: ParseOptions): Promise<Config>
function parseFileAsync(path: string, options?: ParseOptions): Promise<Config>

type ParseOptions = {
  /**
   * include ディレクティブの起点ディレクトリ。
   * parseFile / parseFileAsync でこのオプションを省略した場合、
   * 対象ファイルのディレクトリを自動的に baseDir として使用する。
   * parse / parseAsync で省略した場合は process.cwd()（Node.js）または undefined（ブラウザ）。
   */
  baseDir?: string

  /**
   * 環境変数テーブル。substitution 解決時の process.env フォールバックに使う。
   * 省略した場合: Node.js では process.env を使用、ブラウザでは {} を使用。
   * ブラウザで process が未定義でもクラッシュしない（typeof process でガード）。
   */
  env?: Record<string, string>

  /**
   * ファイル読み込み関数。デフォルトは Node.js の fs.readFileSync / fs.promises.readFile。
   * ブラウザやカスタム環境では差し替えて使う。
   * parseAsync / parseFileAsync は readFile（非同期版）を使う。
   * parse / parseFile は readFileSync（同期版）を使う。
   */
  readFile?: (path: string) => Promise<string>
  readFileSync?: (path: string) => string
}
```

**`parseAsync` の位置づけ：**
`parseAsync` は原則として同期パイプラインを `Promise.resolve()` でラップした非同期ラッパー。
ただし `include` ディレクティブが存在する場合は `readFile`（非同期）を呼び出すため本物の非同期処理になる。
`parse`（同期）と `parseAsync`（非同期）は API 対称性のために両方提供する。

### Config クラス

```ts
// src/config.ts

class Config {
  // プレーンアクセス（型アサーション、なければ ConfigError をスロー）
  get(path: string): unknown
  getString(path: string): string
  getNumber(path: string): number    // 文字列値は数値に強制変換しない。型不一致は ConfigError
  getBoolean(path: string): boolean
  getConfig(path: string): Config
  getList(path: string): unknown[]   // 要素は toObject() 変換済みのプレーン JS 値

  // Zod 付きアクセス（型安全、後述）
  // ※ ZodType を直接型シグネチャに含めると peer dep 未インストール時にコンパイルエラーになるため、
  //   Zod 付きアクセスは src/zod.ts のヘルパー関数として提供する（後述）

  // ユーティリティ
  /**
   * パスが存在するか確認する。値が null でも true を返す（Go 版と同じ）。
   */
  has(path: string): boolean
  keys(): string[]
  /**
   * レシーバーの値を優先し、fallback はレシーバーにないキーのデフォルト値を提供する。
   * Go 版の WithFallback と同じセマンティクス（receiver wins）。
   */
  withFallback(fallback: Config): Config
  /**
   * HoconValue ツリーをプレーン JS オブジェクトに再帰的に変換する。
   * Map は Record<string, unknown> に変換される（JSON.stringify 互換）。
   * 数値はすべて JS number として返す。
   */
  toObject(): unknown
}
```

**`getNumber` のコーション：**
スカラー値が `number` 型の場合のみ成功。`string` 型は ConfigError（文字列 `"42"` は数値に変換しない）。
期間や容量の文字列（`"10s"`, `"1MB"`）は `getString` で取得して呼び出し側で変換するか、Zod スキーマで変換する。

### Zod インテグレーション

Zod は optional peer dependency。`ZodType` を `Config` クラスに直接含めると peer dep 未インストール時に TypeScript がコンパイルエラーを出すため、**Zod 関連の API は `src/zod.ts` のヘルパー関数として提供する**。

```ts
// src/zod.ts
import type { ZodType, infer as ZodInfer } from 'zod'

/**
 * Config 全体を Zod スキーマで検証する。
 * config.toObject() の結果を schema.parse() に渡す。
 * 検証失敗は ZodError をスロー。
 */
export function validate<T>(config: Config, schema: ZodType<T>): T

/**
 * 特定パスの値を Zod スキーマで検証する。
 */
export function getValidated<T>(config: Config, path: string, schema: ZodType<T>): T
```

**使用例：**

```ts
import { parse } from '@o3co/ts.hocon'
import { validate, getValidated } from '@o3co/ts.hocon/zod'
import { z } from 'zod'

const cfg = parse(`server { host = "localhost", port = 8080 }`)

// フル検証
const AppSchema = z.object({ server: z.object({ host: z.string(), port: z.number().int() }) })
const app = validate(cfg, AppSchema)  // z.infer<typeof AppSchema>

// パス指定アクセス
const port = getValidated(cfg, "server.port", z.number().int())  // number
```

**変換フロー：**

```text
HoconValue → config.toObject() → プレーン JS オブジェクト → schema.parse(obj)
```

---

## Error Handling

```ts
// src/errors.ts

class ParseError extends Error {
  line: number
  col: number
  file?: string      // include 先のファイルパス（ルートファイルでは undefined）
}

class ResolveError extends Error {
  path: string       // HOCON パス（例: "server.host"）
  line: number       // 0 の場合あり（include エラー等、位置情報なし）
  col: number        // 0 の場合あり
  file?: string
}

class ConfigError extends Error {
  path: string       // アクセスしようとしたパス
}
```

`ResolveError.line` / `col` はケースによっては 0 になる（`include` に関連するエラーなど）。
呼び出し側は 0 を「位置情報なし」として扱う。

---

## Testing Strategy

- **ユニットテスト：** Lexer / Parser / Resolver それぞれ独立してテスト
- **統合テスト：** `parse()` → `Config` の end-to-end
- **仕様準拠テスト：** Lightbend 公式テストスイート（`tests/lightbend/`）を Go 版と同様に取り込む
- **Zod テスト：** スキーマ検証・型推論の正しさを確認

---

## HOCON Spec Compliance

Go 版に準じて以下をサポート：

- オブジェクト・配列・スカラー値
- コメント（`#`、`//`）
- 複数行文字列（`"""`）
- ドット記法キー（`a.b.c`）、クォートキーはドット分割しない
- オブジェクトのマージ・上書き
- `+=` 追記演算子（対象キー未存在時は空配列を初期値とする）
- substitution：必須 `${path}`、オプション `${?path}`
- 自己参照 substitution（`priorValues` による解決）
- `include "file"` / `include file("file")`
- 環境変数フォールバック
- サイクル検出（substitution・include 両方）

非対応（初期バージョン）：

- `include url(...)`
- `include classpath(...)`
- `.properties` ファイル

---

## Browser Compatibility

- `parseFile` / `parseFileAsync` は Node.js 専用。ブラウザで呼ぶと明示的なエラーをスロー（`"parseFile is not supported in browser environments"`）。
- `parse()` / `parseAsync()` はブラウザ対応。
- `process.env` は `typeof process !== 'undefined'` でガードし、ブラウザでは `{}` を使う。
- ブラウザで `include` を使う場合は `ParseOptions.readFile` を指定する（HTTP fetch 等で実装可能）。
