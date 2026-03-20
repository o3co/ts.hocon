# ts.hocon

[![npm](https://img.shields.io/npm/v/@o3co/ts.hocon.svg)](https://www.npmjs.com/package/@o3co/ts.hocon)
[![CI](https://github.com/o3co/ts.hocon/actions/workflows/test.yml/badge.svg)](https://github.com/o3co/ts.hocon/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/o3co/ts.hocon/branch/main/graph/badge.svg)](https://codecov.io/gh/o3co/ts.hocon)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

[Lightbend HOCON](https://github.com/lightbend/config/blob/main/HOCON.md) 仕様に完全準拠した TypeScript ライブラリです。

> **[Claude](https://claude.ai/)（Anthropic）による実装** — Claude Code を用いて設計・実装されました。

[English](README.md)

---

## 特徴

- 完全な HOCON パース：オブジェクト、配列、スカラー値、代入（`${path}`、`${?path}`）
- 自己参照代入（`path = ${path}:/extra`）
- 重複キーのディープマージ（後勝ち）
- `+=` 追加演算子
- `include "file.conf"` および `include file("file.conf")` ディレクティブ
- トリプルクォート文字列（`"""..."""`）
- 同期・非同期 API（`parse` / `parseAsync` / `parseFile` / `parseFileAsync`）
- ESM + CJS デュアルパッケージ
- [Zod](https://zod.dev/) スキーマバリデーション統合（オプション）
- ブラウザ対応（`parse`/`parseAsync` — Node.js 不要）

## インストール

```bash
npm install @o3co/ts.hocon
```

Node.js 18 以上が必要です。

## クイックスタート

```ts
import { parse, parseFile } from '@o3co/ts.hocon'

// 文字列からパース
const cfg = parse(`
  server {
    host = "localhost"
    port = 8080
  }
`)

// ファイルからパース
const cfg = parseFile('application.conf')

// スカラーゲッター（存在しない・型が違う場合は ConfigError をスロー）
const host = cfg.getString('server.host')   // "localhost"
const port = cfg.getNumber('server.port')   // 8080

// 安全なアクセス
const host = cfg.get('server.host')         // unknown | undefined
const exists = cfg.has('server.host')       // true
```

## API

### パース関数

```ts
import { parse, parseAsync, parseFile, parseFileAsync } from '@o3co/ts.hocon'
import type { ParseOptions } from '@o3co/ts.hocon'

parse(input: string, opts?: ParseOptions): Config
parseAsync(input: string, opts?: ParseOptions): Promise<Config>
parseFile(path: string, opts?: ParseOptions): Config
parseFileAsync(path: string, opts?: ParseOptions): Promise<Config>
```

`ParseOptions`:
| オプション | 型 | 説明 |
|----------|-----|------|
| `baseDir` | `string` | `include` 解決のベースディレクトリ |
| `env` | `Record<string, string>` | 代入で使用する環境変数（デフォルト: `process.env`） |
| `readFileSync` | `(path: string) => string` | カスタムファイルリーダー（同期） |
| `readFile` | `(path: string) => Promise<string>` | カスタムファイルリーダー（非同期） |

### Config メソッド

| メソッド | 戻り値 | スローする条件 |
|---------|--------|--------------|
| `get(path)` | `unknown \| undefined` | — |
| `getString(path)` | `string` | 存在しない、型が違う |
| `getNumber(path)` | `number` | 存在しない、型が違う |
| `getBoolean(path)` | `boolean` | 存在しない、型が違う |
| `getConfig(path)` | `Config` | 存在しない、オブジェクトでない |
| `getList(path)` | `unknown[]` | 存在しない、配列でない |
| `has(path)` | `boolean` | — |
| `keys()` | `string[]` | — |
| `withFallback(fallback)` | `Config` | — |
| `toObject()` | `unknown` | — |

### Zod 統合

```ts
import { validate, getValidated } from '@o3co/ts.hocon/zod'
import { z } from 'zod'

const Schema = z.object({
  server: z.object({
    host: z.string(),
    port: z.number().int(),
  }),
})

// 設定全体をバリデート
const app = validate(cfg, Schema)

// 特定パスをバリデート
const port = getValidated(cfg, 'server.port', z.number().int())
```

Zod をピア依存としてインストール:
```bash
npm install zod
```

### エラー型

```ts
import { ParseError, ResolveError, ConfigError } from '@o3co/ts.hocon'

// ParseError   — 字句解析・構文解析エラー: .line, .col, .file?
// ResolveError — 代入・include 解決エラー: .path, .line, .col, .file?
// ConfigError  — 型不一致・パス不存在エラー: .path
```

## HOCON の例

```hocon
# # または // でコメント
database {
  host = "db.example.com"
  port = 5432
  url  = "jdbc:"${database.host}":"${database.port}
}

# 重複キーはディープマージ（スカラーは後勝ち）
server { host = localhost }
server { port = 8080 }      // 結果: { host: "localhost", port: 8080 }

# 自己参照による追記
path = "/usr/bin"
path = ${path}":/usr/local/bin"

# += 短縮構文
items = [1]
items += 2
items += 3   // [1, 2, 3]

# Include
include "defaults.conf"
include file("overrides.conf")

# トリプルクォート複数行文字列
description = """
  これは
  複数行の文字列です。
"""
```

## 仕様準拠

[Lightbend 公式テストスイート](https://github.com/lightbend/config/tree/main/config/src/test/resources)でテスト済み: **13/13 テストグループ合格**。

v0.1.0 で未対応の機能:
- `include url(...)`
- `include classpath(...)`
- `.properties` ファイルのパース

## ブラウザ対応

`parse()` と `parseAsync()` はブラウザで動作します。`parseFile()` と `parseFileAsync()` は Node.js（またはカスタムの `readFileSync`/`readFile` オプション）が必要です。

```ts
// カスタムファイルローダーを使ったブラウザ利用
const cfg = await parseAsync(hoconString, {
  readFile: async (path) => {
    const res = await fetch(`/config/${path}`)
    return res.text()
  },
})
```

## ライセンス

Apache License 2.0 — [LICENSE](LICENSE) を参照。

Copyright 2026 o3co Inc.
