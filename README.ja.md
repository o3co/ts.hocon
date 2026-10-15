# ts.hocon — TypeScript 向け HOCON パーサー

[![npm](https://img.shields.io/npm/v/@o3co/ts.hocon.svg)](https://www.npmjs.com/package/@o3co/ts.hocon)
[![CI](https://github.com/o3co/ts.hocon/actions/workflows/test.yml/badge.svg)](https://github.com/o3co/ts.hocon/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/o3co/ts.hocon/branch/develop/graph/badge.svg)](https://codecov.io/gh/o3co/ts.hocon)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

[Lightbend HOCON](https://github.com/lightbend/config/blob/main/HOCON.md) 仕様の TypeScript パーサー。現在の準拠率は [仕様準拠](#仕様準拠) を参照。

> **[Claude](https://claude.ai/)（Anthropic）による実装** — Claude Code を用いて設計・実装されました。
> [GitHub Copilot](https://github.com/features/copilot) および [OpenAI Codex](https://openai.com/index/openai-codex/) によるレビュー。

**ドキュメント:** [o3co.github.io/hocon](https://o3co.github.io/hocon/) — 4 実装・hocon2 CLI・共通の準拠コーパスをまとめた横断ハブです。

[English](README.md)

> **ライブラリの位置づけ:** ts.hocon は HOCON の設定ローダーです。`.hocon` 設定ファイルを読み、Config API（`getString`、`getNumber`、`getBoolean`、`getDuration`、`getBytes`、`getPeriod`、`toObject`）で型付きのアクセスを提供することが目的で、低レベルのパーサー API ではありません。`HoconValue` などの内部型はマイナーバージョン間で変わることがあります。
>
> **言語横断の準拠:** この実装は [o3co/xx.hocon](https://github.com/o3co/xx.hocon) の共通の期待値 JSON fixture に対して、[go.hocon](https://github.com/o3co/go.hocon)、[rs.hocon](https://github.com/o3co/rs.hocon)、[py.hocon](https://github.com/o3co/py.hocon) と並べてテストされており、4 つの実装が同じ Lightbend HOCON 仕様を満たすことを確かめています。

---

## クイックスタート

### 1. インストール

```bash
npm install @o3co/ts.hocon
```

Node.js 22 以上が必要です。

ESM / CJS の両方に対応しています。`import` でも `require` でも同じエントリポイント
（`adapters/*` のサブパスを含む）に到達します:

```ts
import { parse } from '@o3co/ts.hocon'          // ESM
const { parse } = require('@o3co/ts.hocon')     // CJS
```

CI では PR ごと・リリースごとに、ビルド成果物に対して 8 つの export すべてを両形式で
ロードし、実際に呼び出し（バンドル形式で挙動が変わる package include を含む）、サブパスが
返す値や投げるエラーが root の export するクラスのインスタンスであること、各 export 条件が
自前の型定義を宣言していることまで検証します。1.10.0 で当時の CJS の 7 エントリポイントすべてが
ロード時に例外を投げたことがあるためのゲートであり、この種の欠陥を検出するものです
（あらゆる欠陥が起こり得ないという保証ではありません）。

### 2. 使い方

```ts
import { parse } from '@o3co/ts.hocon'

const cfg = parse(`
  server {
    host = "localhost"
    port = 8080
  }
`)

cfg.getString('server.host')   // "localhost"
cfg.getNumber('server.port')   // 8080
cfg.has('server.host')         // true
```

## なぜ HOCON？

| | `.env` | JSON | YAML | HOCON |
|---|---|---|---|---|
| Comments | No | No | Yes | Yes |
| Nesting | No | Yes | Yes | Yes |
| References / Substitution | No | No | No | Yes (`${var}`) |
| File inclusion | No | No | No | Yes (`include`) |
| Object merging | No | No | Anchors (fragile) | Yes (deep merge) |
| Optional values | No | No | No | Yes (`${?var}`) |
| Trailing commas | N/A | No | N/A | Yes |
| Unquoted strings | Yes | No | Yes | Yes |

HOCON は単なるシリアライズ形式ではなく、**プログラムに注入するための設定言語** です。JSON / YAML / TOML はデータ構造の表現に徹しており、ファイルの重ね合わせ・環境変数・参照解決はアプリ側（Pydantic、Serde、Zod 等）の責務になります。HOCON はそれらを仕様そのものに内包しているため、プログラムが設定を受け取る時点で、フォールバックは合成済み・`${VAR}` 参照は解決済みの「1 枚の設定」になっています。「このレイヤーに値があるか？」に由来する条件分岐は、コードではなくフォーマット境界で消えます。

加えて HOCON は YAML の可読性と JSON の構造性を兼ね備えるため、フラットなキーバリュー設定を超えるユースケースには強い選択肢になります。

## モジュールの中に閉じる設定

大規模なコードベースでは、設定は漏れ出しがちです。全チームが編集する 1 つの大きなファイル、サービスごとにコピーされたデフォルト値、互いのキーを読み合うモジュール。HOCON なら、各モジュールがコードと同じように自分の設定を持てます。

- **各モジュールが名前空間を持ち、自分のデフォルト値を同梱する。** `auth` モジュールは `auth { … }` をコードの隣に置き、デフォルト値をすべて埋めておきます。アプリケーションはそのデフォルト値をコピーせず、`include` 1 行で取り込みます。
- **アプリケーションは違うところだけを上書きする。** 後のレイヤーが前のレイヤーにディープマージされるので、アプリケーションが書くのはブロック全体ではなく 2 つのキーだけです。
- **各モジュールは自分のサブツリーだけを、自分のスキーマで読む。** モジュールは `auth` を要求し、自分で定義したスキーマで検証します。そのセクションの形がモジュールの契約で、ファイルの他の部分はモジュールから見えません。
- **モジュール間の結線はアプリケーションに置く。** モジュールは自分が読むキー（`auth.db`）を宣言するだけで、アプリケーションが与えるべきものにはデフォルト値を置きません。アプリケーションがそれを共有の値に結びつけます（`auth.db = ${shared.db}`）。モジュールは互いのキーもアプリケーションのキーも参照しないので、依存は一方向に流れます。

```hocon
# auth/reference.conf: auth パッケージに同梱され、auth チームが持つ
auth {
  session { lifetime = 30m, max-body = 64KiB }
  # db: デフォルトなし。auth.db はアプリケーションが与える
}
```

```hocon
# application.conf: アプリケーションが持つ
include package("github.com/acme/auth", "reference.conf")

shared.db { host = db.internal, port = 5432 }
auth.db = ${shared.db}       # 結線はアプリケーションに置く
auth.session.lifetime = 2h   # 違うところだけ上書きする。残りはモジュールのデフォルトのまま
```

```ts
// auth モジュールの中
import { getValidated, hocon } from '@o3co/ts.hocon/zod'
import { z } from 'zod'

const Auth = z.object({
  session: z.object({
    lifetime: hocon.duration('s').pipe(z.number().int().positive()),
    'max-body': hocon.bytes().pipe(z.number().int().positive()),
  }),
  db: z.object({ host: z.string(), port: z.number().int() }),
})
const auth = getValidated(config, 'auth', Auth)
```

`include package(...)` は HOCON.md の一部ではなく、o3co の各実装が共有する規約（[E11](https://github.com/o3co/xx.hocon/blob/main/docs/extra-spec-conventions.md#e11)）で、`include classpath(...)` の JVM 以外での対応物です。モジュールは、アプリケーションがファイルの置き場所を知らなくても済む形でデフォルト値を公開できます（ts.hocon の既定のリゾルバーは `<identifier>/<file>` を include 元のファイルから Node のモジュール解決に渡すので、identifier には `@acme/auth` のような npm のパッケージ名を書きます。TS だけで使う設定ではこれも E11 で認められています。上の例のような言語横断の Go 形式の identifier を使うには、それをパッケージに対応づける `packageResolver` が必要です。[`ParseOptions`](#パース関数) を参照）。JVM では Lightbend の `reference.conf` 規約が同じ役割を果たします。

## 特徴

- 完全な HOCON パース：オブジェクト、配列、スカラー値、代入（`${path}`、`${?path}`）
- 自己参照代入（`path = ${path}:/extra`）
- 重複キーのディープマージ（後勝ち）
- `+=` 追加演算子
- `include "file.conf"` および `include file("file.conf")` ディレクティブ
- トリプルクォート文字列（`"""..."""`）
- duration・byte size・period の読み取り（`getDuration()`、`getBytes()`、`getPeriod()`）
- HOCON エミッタ（`renderHocon()`）— 解決済み `Config` を HOCON テキストとして出力。再パースすると同一の値ツリーになる（E18 ラウンドトリップ契約）
- 同期・非同期 API（`parse` / `parseAsync` / `parseFile` / `parseFileAsync`）
- ESM + CJS デュアルパッケージ（全エントリポイントを CI で両形式ロード検証）
- [Zod](https://zod.dev/) スキーマバリデーション統合（オプション）
- ブラウザで動作（`parse`/`parseAsync`。bundler で Node の組み込みモジュールを stub する必要あり。[ブラウザ対応](#ブラウザ対応)を参照）

## API

API の詳細は [o3co.github.io/ts.hocon](https://o3co.github.io/ts.hocon/) を参照してください（TypeDoc で生成し、マイナー / メジャーリリースごとに更新）。

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
| `resolveSubstitutions` | `boolean` | `false` にすると未解決の Config を返し、後で解決できる（デフォルト `true`。[遅延解決](#遅延解決-apie12)を参照） |
| `originDescription` | `string` | ファイルパスがないときに解決エラーのメッセージで使うソース名 |
| `resolveFrom` | `string \| string[]` | `include package(...)` で Node のモジュール解決を始める場所（デフォルト: `baseDir`。`parseFile` ではファイルのディレクトリ。なければ `process.cwd()`） |
| `packageResolver` | `PackageResolver` | `include package(...)` 用の独自リゾルバー（Yarn PnP、bundler、エッジランタイム、テスト）。指定すると `resolveFrom` は無視される |

### Config メソッド

| メソッド | 戻り値 | スローする条件 |
|---------|--------|--------------|
| `get(path)` | `unknown \| undefined` | — |
| `getValue(path)`（値ツリーをそのまま返す。構造の確認用） | `ReadonlyHoconValue \| undefined` | 未解決 |
| `getString(path)` | `string` | 存在しない、型が違う、未解決 |
| `getNumber(path)` | `number` | 存在しない、型が違う、未解決 |
| `getBoolean(path)` | `boolean` | 存在しない、型が違う、未解決 |
| `getConfig(path)` | `Config` | 存在しない、オブジェクトでない、未解決 |
| `getList(path)` | `unknown[]` | 存在しない、配列でない、未解決 |
| `getDuration(path, unit?)` | `number` | 存在しない、文字列でも数値でもない、duration として不正、有限の数値にならない（E21） |
| `getBytes(path, unit?)` | `number` | 存在しない、文字列でも数値でもない、byte size として不正、負の値、2^53-1 バイトを超える |
| `getPeriod(path)` | `Period` | 存在しない、文字列でも数値でもない、period として不正 |
| `has(path)` | `boolean` | — |
| `keys()` | `string[]` | — |
| `withFallback(fallback)` | `Config` | — |
| `resolve(opts?)` | `Config` | 解決できない代入（`allowUnresolved: true` の場合を除く） |
| `resolveWith(source, opts?)` | `Config` | source が未解決、解決できない代入 |
| `isResolved()` | `boolean` | — |
| `toObject(opts?)` | `unknown` | —（`{ nullPrototype: true }` で何も継承しないオブジェクトを返す。[セキュリティ上の考慮事項](#セキュリティ上の考慮事項)を参照） |
| `renderHocon()` | `string` | 未解決 |

上の「スローする条件」はすべて `.path` を持つ `ConfigError` です。ただし次の 2 つは別のクラスです。`getValue` や getter で未解決の値を読んだとき、および `resolveWith` の source が未解決のときは `NotResolvedError`（`ConfigError` のサブクラス）を投げます。`resolve` / `resolveWith` で解決できない代入は `ResolveError` です。

### 遅延解決 API（E12）

パース、フォールバックの重ね合わせ、解決を別々の手順に分け、実行時に設定を注入できます。

```ts
import { parseStringWithOptions, fromMap, empty } from '@o3co/ts.hocon'
import type { ResolveOptions } from '@o3co/ts.hocon'

// 1. 解決せずにパース — 代入は保留される
const cfg = parseStringWithOptions(
  'version = ${shortversion}-${CI_RUN_NUMBER}\nvariables { shortversion = "1.2.3" }',
  { resolveSubstitutions: false }
)
cfg.isResolved() // false — ${CI_RUN_NUMBER} がまだ保留中

// 2. 実行時のフォールバックを重ねる
const runtime = fromMap({ CI_RUN_NUMBER: '42' })
const vars = cfg.getConfig('variables')   // 代入ではないので、もう取得できる
const merged = cfg.withFallback(runtime).withFallback(vars)

// 3. フォールバックの重なり全体を解決する
const resolved = merged.resolve({ useSystemEnvironment: false })
resolved.getString('version') // "1.2.3-42"

// resolveWith: source を参照用に使って receiver を解決する。source のキーは結果に入らない
const receiver = parseStringWithOptions('r = ${key}', { resolveSubstitutions: false })
const source = fromMap({ key: 'val' })
const result = receiver.resolveWith(source)
result.has('key')    // false — source のキーは含まれない
result.getString('r') // "val"
```

`ResolveOptions`:

| オプション | 型 | デフォルト | 説明 |
|--------|------|---------|-------------|
| `useSystemEnvironment` | `boolean` | `true` | 代入のフォールバックとして環境変数（`ParseOptions.env`、デフォルトは `process.env`）を参照する |
| `allowUnresolved` | `boolean` | `false` | 解決できない代入をそのまま残す（エラーにしない） |

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

HOCON の duration と byte size は文字列（`30m`、`64KiB`）なので、`z.number()` では通りません。`hocon.duration(unit?)` / `hocon.bytes(unit?)` マーカーは `getDuration()` / `getBytes()` と同じ規則で読み、指定した単位の数値を返します（既定は `ms` / `B`。単位のない数値は getter と同じ意味）。範囲や整数のチェックは、マーカーを数値スキーマに pipe して書きます:

```ts
import { hocon, getValidated } from '@o3co/ts.hocon/zod'

const Session = z.object({
  lifetime: hocon.duration('s').pipe(z.number().int().min(60).max(86_400)),
  maxBody: hocon.bytes().pipe(z.number().int().positive()),
})

// session { lifetime = 30m, maxBody = 64KiB }
getValidated(cfg, 'session', Session) // { lifetime: 1800, maxBody: 65536 }
```

`hocon.period()` は `getPeriod()` と同じ規則で period を読み、`Period`（`{ years, months, days }`）を返します。制約はスキーマ側で refine します:

```ts
const Backup = z.object({
  keep: hocon.period().refine((p) => p.years === 0, 'use months or days'),
})

// backup { keep = 2w }
getValidated(cfg, 'backup', Backup) // { keep: { years: 0, months: 0, days: 14 } }
```

不正な duration / byte size / period は、キーのパス付きのバリデーションエラーになります。マーカーは普通の Zod スキーマなので、`validate`・`getValidated`・`parseWithSchema`・`parseFileWithSchema` をはじめ、Zod が実行するところならどこでも使えます。指数表記（`1e3`、`"1.5e2s"`）は getter もマーカーも読みます。ただしマーカーは数値を JavaScript の値として読むため、double の精度を超える桁数の数値リテラルは、リテラルの文字列を正確に読む getter と結果が異なることがあります（`1.99999999999999999` B は `getBytes()` では 1、マーカーでは 2）。period のマーカーは、小数点や指数を含むリテラル（`7.0`、`1e2`）も整数として読みます（`getPeriod()` は拒否します）。単位付きで書けば（`30s`、`7d`）どちらの差も出ません。

未解決の Config（`resolveSubstitutions: false` でパースしたもの、`resolve()` 前のフォールバックの重なり、または何かが残った `resolve({ allowUnresolved: true })` の結果）に対しては、`validate` は保留中の値が欠けたツリーを検証するのではなく、getter と同じく `NotResolvedError` を投げます。`getValidated` は、値が未解決のパスでは `NotResolvedError` を投げ、解決済みのパスなら検証します。先に `resolve()` を呼んでください。

Zod をピア依存としてインストール:
```bash
npm install zod
```

Zod の入口（`validate`・`getValidated`・`parseWithSchema`・`parseFileWithSchema`）は、値のどこかに `__proto__`・`constructor`・`prototype` という名前のキーがあると拒否します。Zod は record から `__proto__` キーをエラーなしで落とすため、また結果がスキーマによって変わらないように、3 つとも同じく拒否します。`ZodError` にはキーごとに 1 つの issue が入ります。issue はそのキーを持つオブジェクトの位置に付き、キー名は message と `params.key` に入ります（`key "__proto__" names an object's prototype → at limits`）。キー名を変えるか、影響を受けない通常の getter（`cfg.getNumber('limits."constructor"')`）で読んでください。

### エラー型

```ts
import { ParseError, ResolveError, PackageLookupError, ConfigError, NotResolvedError } from '@o3co/ts.hocon'

// ParseError         — 字句解析・構文解析エラー: .line, .col, .file?
// ResolveError       — 代入・include 解決エラー: .path, .line, .col, .file?
// PackageLookupError — include package(...) が見つからない（ResolveError のサブクラス）: .identifier, .packageFile
// ConfigError        — 型不一致・パス不存在・不正な値: .path
// NotResolvedError   — 未解決の値を getter や Zod の入口で読んだ（ConfigError のサブクラス）: .path
```

どのエントリポイント（`/zod`、`/adapters/*`）もこれらと同じクラスを投げるので、同じモジュールシステムの中であれば、root の export に対する `instanceof` がエントリポイントをまたいで効きます。Zod の入口は、値がスキーマに合わないとき `ZodError` を投げます。

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

### duration と byte size

```ts
const c = parse(`
  timeout   = "30s"
  cache-ttl = "5m"
  max-size  = "512MiB"
`)

c.getDuration('timeout')        // 30000 (ms)
c.getDuration('timeout', 's')   // 30
c.getDuration('cache-ttl', 'm') // 5

c.getBytes('max-size')          // 536870912 (bytes)
c.getBytes('max-size', 'MiB')  // 512
```

duration の単位: `ns`、`us`、`ms`、`s`、`m`、`h`、`d`（`seconds`、`minutes` などの長い形も可）。duration の単位名は大文字小文字を区別し、小文字のみです（HOCON 仕様）。単位のない数値や文字列は、duration ではミリ秒、byte size ではバイトとして読みます。

数値は文字列から正確な 10 進数として読み、単位との積も正確に計算します（E20）。duration はそのあと指定の単位で 1 回だけ丸めます。`1.001s` は `1001` ms（`1001000000` ns）です（Lightbend の double の計算では `1000999999` ns になります）。byte size は、変換の前に 0 方向へ切り捨てて整数バイトにします（Lightbend と同じ）。`1.0009kB` は `1000` です。値が有限の数値にならない duration はエラーです（E21）。byte size は 0 以上かつ 2^53-1 バイト（JS の number が正確に表せる最大の整数）以下でなければならないので、exa・zetta・yotta の単位（`EB`、`Ei`/`EiB`、`E`/`e`、`exabyte` など、`Y` まで）を 1 以上の量で書くとエラーになります。小数（`0.001EiB`）か、もっと小さい単位を使ってください。

byte size の単位は Lightbend と同じ集合で、同じく大文字小文字を区別します:

- バイト: `B`、`b`、`byte`、`bytes`
- 1000 のべき: `kB`、`MB`、`GB`、`TB`、`PB`、`EB`、`ZB`、`YB`、および `kilobyte(s)` … `yottabyte(s)`
- 1024 のべき: `Ki`/`KiB`、`Mi`/`MiB`、… `Yi`/`YiB`、および `kibibyte(s)` … `yobibyte(s)`
- 1 文字（1024 のべき、大文字小文字どちらも可。java `-Xmx` 形式）: `K`/`k`、`M`/`m`、`G`/`g`、`T`/`t`、`P`/`p`、`E`/`e`、`Z`/`z`、`Y`/`y`

それ以外の綴りはエラーです: `KB`、`kb`、`kib`、`Kilobytes`、`MEGABYTES`。（`getBytes(path, unit)` に渡す `'KB'` などは出力単位で、別の一覧です。）

### period

```ts
const c = parse(`
  retention = 2w
  billing   = "1 month"
  archive   = 1y
  grace     = 3       // 単位のない整数は日数
`)

c.getPeriod('retention') // { years: 0, months: 0, days: 14 }
c.getPeriod('billing')   // { years: 0, months: 1, days: 0 }
c.getPeriod('archive')   // { years: 1, months: 0, days: 0 }
c.getPeriod('grace')     // { years: 0, months: 0, days: 3 }
```

period の単位は `d`/`day`/`days`、`w`/`week`/`weeks`（日数に畳み込み）、`m`/`mo`/`month`/`months`、`y`/`year`/`years` です。単位は小文字のみで、大文字小文字を区別します（ここでの `m` は分ではなく月）。period は整数のみ（`7.5` はエラー。duration や byte size とは違います）で、負の値も読めます。各成分は 32 bit 符号付き整数に収まる必要があります（Lightbend の `java.time.Period`、rs.hocon、py.hocon と同じ）。

## 仕様準拠

[Lightbend HOCON 仕様](https://github.com/lightbend/config/blob/main/HOCON.md) への準拠状況は [`docs/spec-compliance.md`](docs/spec-compliance.md) に項目単位で記載しており、以下の表はそこから計算されます — `tests/docs.test.ts` が再計算し、表がずれるとビルドが fail します。実装横断のロールアップは [`xx.hocon/docs/compliance-matrix.md`](https://github.com/o3co/xx.hocon/blob/main/docs/compliance-matrix.md) を参照してください。

| 指標                                   | 状況          |
| -------------------------------------- | ------------- |
| 仕様全体（out-of-scope を含む）        | **91.9%**     |
| In-scope のみ                          | **100.0%**    |
| Lightbend `test01`–`test13` テスト群   | 13/13 合格    |

**仕様外の規約（E シリーズ）の実装状況:**

| 項目 | 内容 | 状況 |
|------|------|------|
| E11  | `include package(...)` によるサービスロケーター型の include | ✅ v1.4.0 |
| E12  | 遅延解決（`parse → withFallback → resolve()` のライフサイクル） | ✅ v1.4.0 |
| E18  | HOCON エミッタのラウンドトリップ契約（`renderHocon()`） | ✅ v1.13.0 |
| E19  | double の範囲を超える浮動小数点リテラル（`1e999`）はパースエラー | ✅ v1.14.0 |
| E20  | 単位値の計算は正確な 10 進数（duration は Lightbend からの意図的な乖離） | ✅ v1.14.0 |
| E21  | 実装が表現できない duration はエラー | ✅ v1.14.0 |

E シリーズは、HOCON.md の外で o3co の各実装が共有する規約です。[`xx.hocon/docs/extra-spec-conventions.md`](https://github.com/o3co/xx.hocon/blob/main/docs/extra-spec-conventions.md) を参照してください。

未対応の機能:

- `include url(...)`
- `include classpath(...)`

v1.0.0 から対応（P1）:

- `.properties` ファイルの読み込み

## パフォーマンス

### ts.hocon のパースコスト

[Vitest bench](https://vitest.dev/guide/features.html#benchmarking)（tinybench）で計測。`pnpm bench` で再現できます。

| シナリオ | ops/sec | 1回あたりの時間 |
|---|---|---|
| 小規模設定（10キー） | ~200,000 | ~5 µs |
| 中規模設定（100キー） | ~23,000 | ~43 µs |
| 大規模設定（1,000キー） | ~2,100 | ~476 µs |
| substitution 10個 | ~74,000 | ~14 µs |
| substitution 50個 | ~14,000 | ~71 µs |
| substitution 100個 | ~6,900 | ~145 µs |
| ネスト深度 5 | ~210,000 | ~5 µs |
| ネスト深度 10 | ~147,000 | ~7 µs |
| ネスト深度 20 | ~80,000 | ~13 µs |

### JSON.parse との比較

JSON.parse は V8 のネイティブ C++ 実装であり、最速の基準線です。この比較は HOCON の豊富な機能によるオーバーヘッドを示します。

| 設定サイズ | ts.hocon | JSON.parse | 倍率 |
|---|---|---|---|
| 小規模（10キー） | ~198K ops/s | ~1,967K ops/s | ~10x |
| 中規模（100キー） | ~23K ops/s | ~280K ops/s | ~12x |
| 大規模（1,000キー） | ~2.2K ops/s | ~12K ops/s | ~5.4x |

一般的なアプリケーション設定（起動時に1回読み込み）であれば、パースコストは無視できるレベルです。1,000キーの設定でも 0.5 ms 未満でパースできます。

### node-config との機能比較

JSON の設定ファイルを読む [node-config](https://github.com/node-config/node-config) **v5.0.1** との機能比較（2026-10-16 時点）:

| 機能 | ts.hocon | node-config (JSON) |
|---|---|---|
| コメント | `//` `#` | 対応（`//`、`/* */`。`.json` を JSON5 として解析） |
| 複数行文字列 | `"""..."""` | 非対応 |
| substitution（`${path}`） | 対応 | 非対応 |
| optional substitution（`${?path}`） | 対応 | 非対応 |
| 環境変数参照 | 対応（substitution経由） | 部分対応（`custom-environment-variables` ファイル） |
| include | 対応 | 非対応 |
| ディープマージ | 対応（オブジェクト。配列は置換、`+=` や連結で追加） | 対応（オブジェクト。配列は置換） |
| 追加演算子（`+=`） | 対応 | 非対応 |
| 環境別設定 | HOCON仕様で自由に構成可 | 対応（ファイル名規約） |
| スキーマ検証 | Zod 統合 | 非対応 |
| プログラマティック API | `parse(string)` | ファイルベース初期化後に `get()` |
| 型付きゲッター | `getString`, `getNumber` 等（実行時に検査） | `get<T>()`（型パラメータのみ、実行時の検査なし） |

## ブラウザ対応

`parse()` と `parseAsync()` はブラウザで動作します。adapter と Zod 連携も同じです。`parseFile()` と `parseFileAsync()` は Node.js（またはカスタムの `readFileSync`/`readFile` オプション）が必要です。

パッケージは Node の組み込みモジュール `fs`・`path`・`module`・`url` を import しています（ファイルの読み込みと `include package(...)` のため）。使うのはその経路だけです。ブラウザ向けの bundle では、これらを空のモジュールに置き換える必要があります:

- **Vite**（7 と 8）は既定でそうするので、設定は不要です。
- **その他の bundler**: 4 つを空のモジュール（`export default {}`）に割り当ててください。たとえば esbuild の plugin や、webpack 5 の `resolve.fallback: { fs: false, path: false, module: false, url: false }` を使います。external にするだけでは足りません。ブラウザは `fs` を読み込めないからです。

ここまでで動くのは、ファイルの include を使わない解析です。独自の `readFile` / `readFileSync`（下記）で include を読む場合は path も解決するので、`path` には空のモジュールではなく、`path-browserify` パッケージのようなブラウザ向けの実装を割り当ててください。`include package(...)` には独自の `packageResolver` が必要です（`ParseOptions` を参照）。

```ts
// カスタムファイルローダーを使ったブラウザ利用
const cfg = await parseAsync(hoconString, {
  readFile: async (path) => {
    const res = await fetch(`/config/${path}`)
    return res.text()
  },
})
```

## ベストプラクティス

### 設定構成

- **ドメインごとに分割**: 設定を論理的な単位に分けましょう（`database.conf`、`server.conf`、`logging.conf`）
- **`include` で合成**: ドメイン別ファイルからフル設定を組み立てましょう
- **設定にロジックを入れない**: HOCON は宣言的なデータのためのもので、条件分岐や計算には向きません

### 環境変数

- **`${ENV}` の使用を最小限に**: 設定ファイル自体にデフォルト値を定義し、`${?ENV}`（オプショナル）を使いましょう
- **ローカル開発で環境変数を必須にしない**: デフォルトだけで動くようにしましょう
- **必須の環境変数を文書化**: プロジェクトの README や `.env.example` にリストしましょう
- **変数名の階層は `.` ではなく `__` で**: `loadEnv`（および `parseDotEnv`）で一括マウント
  するとき、階層を作るのは `__` **だけ** です。`.` は通常のキー文字なので、次の 2 つは
  別々のキーであり、どちらも失われません:

  ```text
  APP_FOO__BAR=nested   # -> foo.bar      : cfg.getString('foo.bar')
  APP_FOO.BAR=dotted    # -> "foo.bar"    : cfg.getString('"foo.bar"')
  ```

  単独の `_` もセグメントの一部のままです（`APP_DB__MAX_CONN` → `db.max_conn`）。

### 開発 / 本番の分離

```text
config/
├── application.conf    # 共有デフォルト
├── dev.conf            # include "application.conf" + 開発用オーバーライド
└── prod.conf           # include "application.conf" + 本番用オーバーライド
```

### バリデーション

- 設定のバリデーションは常にアプリケーション起動時に行い、使用時ではなく早期に検出しましょう
- スキーマバリデーション（TypeScript は Zod、Go は struct Unmarshal、Rust は Serde）を使って早期にエラーをキャッチしましょう

```typescript
import { parseWithSchema } from '@o3co/ts.hocon/zod'
import { z } from 'zod'

const schema = z.object({
  server: z.object({ host: z.string(), port: z.number() }),
  debug: z.boolean(),
})
const config = parseWithSchema(hoconInput, schema) // 起動時に即座に失敗
```

## 関連プロジェクト

| プロジェクト | 言語 | レジストリ | 説明 |
|---------|----------|----------|-------------|
| [go.hocon](https://github.com/o3co/go.hocon) | Go | [pkg.go.dev](https://pkg.go.dev/github.com/o3co/go.hocon) | Go 向け HOCON パーサー |
| [rs.hocon](https://github.com/o3co/rs.hocon) | Rust | [crates.io](https://crates.io/crates/hocon-parser) | Rust 向け HOCON パーサー |
| [py.hocon](https://github.com/o3co/py.hocon) | Python | [PyPI](https://pypi.org/project/hocon-parser/) | Python 向け HOCON パーサー |
| [hocon2](https://github.com/o3co/hocon2) | Go | [pkg.go.dev](https://pkg.go.dev/github.com/o3co/hocon2) | HOCON → JSON/YAML/TOML/Properties 変換 CLI |

4 つのパーサー実装（[ts.hocon](https://github.com/o3co/ts.hocon)、[rs.hocon](https://github.com/o3co/rs.hocon)、[go.hocon](https://github.com/o3co/go.hocon)、[py.hocon](https://github.com/o3co/py.hocon)）はすべて同じ Lightbend HOCON 仕様で追跡されています — 実装ごとの準拠率は [横断ロールアップ](https://github.com/o3co/xx.hocon/blob/main/docs/compliance-matrix.md) を参照してください。

## フォーマットアダプタ

*他のプログラム* が所有する設定ファイルを HOCON としてマウントできます。自分の
ドキュメント内の `${...}` からその内容を参照できるようになります:

```ts
import { parseStringWithOptions } from '@o3co/ts.hocon'
import { loadEnv } from '@o3co/ts.hocon/adapters/env'

const base = loadEnv({ prefix: 'APP_' })            // APP_DB__HOST -> db.host
const cfg = parseStringWithOptions(src, { resolveSubstitutions: false })
const merged = cfg.withFallback(base).resolve()
```

解決を遅延させることが重要です。素の `parse` はパースしながら解決するため、
フォールバックを付ける前に `${...}` の解決が失敗してしまいます。

| サブパス | 必要な依存 | 備考 |
| --- | --- | --- |
| `@o3co/ts.hocon/adapters/properties` | — | `java.util.Properties`。`include` と構文レイヤーを共有 |
| `@o3co/ts.hocon/adapters/env` | — | プレフィックス付き名前空間の一括マウント。`.env` の読み込みも可能 |
| `@o3co/ts.hocon/adapters/jsonc` | — | コメントと末尾カンマを許す JSON |
| `@o3co/ts.hocon/adapters/json5` | — | JSON5 1.0.0。手書き scanner で依存ゼロ |
| `@o3co/ts.hocon/adapters/toml` | `smol-toml`（>= 1.0。推奨 >= 1.9.0、[SECURITY.md](SECURITY.md#the-toml-adapter) 参照） | オプショナルなピア依存 |
| `@o3co/ts.hocon/adapters/yaml` | `yaml`（>= 2.0） | オプショナルなピア依存。スカラー解決はそのライブラリの答えで、`version: '1.2'` を明示してドリフトを防止 |

TOML と YAML のライブラリは **オプショナルなピア依存** なので、本パッケージを入れても
何も追加でインストールされません — 実際に使うものだけを足してください。プレーンな JSON に
アダプタは不要です（HOCON は JSON のスーパーセットです）。

外部のデータはあくまでデータです。マウントされた値の中の `${a.b}` は参照ではなく
リテラルなテキストとして扱われます。そのファイルは HOCON の構文に同意していない
プログラムのものだからです。

### 環境変数名の付け方

パス区切りは `__` だけです。変数名の中の `.` は境界ではなくキー文字なので、
`APP_FOO.BAR` と `APP_FOO__BAR` は別のキーであり、同時に設定できます:

```ts
const cfg = loadEnv({ prefix: 'APP_', env: { 'APP_FOO.BAR': 'dotted', APP_FOO__BAR: 'nested' } })
cfg.getString('"foo.bar"')   // "dotted"  — 名前にドットを含む 1 つのキー
cfg.getString('foo.bar')     // "nested"  — foo -> bar
```

### JSONC / JSON5 / YAML の数値

整数は精度を落とさずに取り込まれます。JS の `number` で表せない幅の整数リテラルも
桁がそのまま保持され、int64 の範囲を超える値は黙って壊れる代わりにエラーになります
（JSON5 の 16 進整数も同じです）。取得結果はゲッターによって変わります:

```ts
const cfg = parseJsonc('{"id": 9007199254740993}')
cfg.getString('id')   // "9007199254740993"  — ソースそのままの正確な値
cfg.getNumber('id')   // 9007199254740992    — JS の数値モデルで丸められる
cfg.toObject()        // { id: 9007199254740992 }
```

したがって大きな識別子（snowflake ID、台帳の連番など）は `getString` で読んでください。
`getNumber` と `toObject` は JavaScript の数値セマンティクスをそのまま適用します
（HOCON テキストに同じリテラルを書いた場合と同じ挙動です）。保証されるのは
**取り込み時に情報が失われない** ことです。

YAML のスカラー解決はそれ以外の点では `yaml` ライブラリのものです。アダプタは
デフォルト任せにせず `version: '1.2'` を明示し、`fromYamlValue` はデコード済みの
ツリーを受け取るため、別のライブラリやスキーマを使うこともできます。

## 既知の制限

- **`include url(...)`** は未対応です。リモート設定の取得はこのパーサーの範囲外です。アプリの HTTP クライアントで取得してから `parse()` に渡してください。
- **`include classpath(...)`** は未対応です。JVM 固有の include 形式で、Java ランタイム以外に対応物がありません。
- **watch / reload なし** — ライブラリはロード時にパースするだけです。ライブリロードが必要なら変更時に `parse()` / `parseFile()` を呼び直してください。
- **ストリーミングパーサーなし** — 入力全体をメモリに載せます。非常に大きな設定はパース前にサイズを検証してください（セキュリティ上の考慮事項を参照）。

## セキュリティ上の考慮事項

信頼できない HOCON 入力をパースする際は次に注意してください:

- **include のパストラバーサル:** 相対 `include` パスは `baseDir` から解決され、`..` セグメントで外に出て `/etc/passwd` のような機密ファイルに到達し得ます。信頼できない入力をパースするなら、パスを検証するカスタム `readFileSync`/`readFile` を渡してください。
- **入力サイズ:** パーサーに入力サイズ上限はありません。信頼できない入力は `parse()` の前にサイズを検証してください。
- **include の深さ:** 深い include 連鎖によるスタックオーバーフローを防ぐため 50 段に制限されています。
- **写像されたパスの深さ:** 環境変数の `__` セグメントと `.properties` のドット区切りキーは
  64 セグメントまでです。1 つの名前が任意の深さの連鎖を 1 本作るため、上限がなければ長い
  変数名 1 つでスタックを使い切れてしまいました。rs.hocon と py.hocon も同じ写像を 64 で
  制限しています。
- **ドキュメントのネストの深さ:** 上限はありません。エンジンのスタックを超えるほど深い
  ドキュメントは `ParseError` か `ConfigError` で失敗します（素の `RangeError` にはなりません）。
  ただし、どの深さで失敗するかは呼び出し側のコードがすでにどれだけ深いかに左右されるので、
  決まった段数に頼らず、信頼できない入力はパース前にサイズを検証してください（上記）。
- **プロトタイプ汚染:** `__proto__` / `constructor` / `prototype` という名前のキーは
  **通常のキーとして保持されます**。`.properties` ファイルや環境変数がそれらを正当に
  使っていることがあり、落とせば黙ったデータ欠落になるからです。ライブラリ内部の安全性は
  拒否リストではなく構造で担保しています。ネスト構築には `__proto__` セッターを継承しない
  null プロトタイプのオブジェクトを使い、各アダプタと `toObject()` はキーを own データ
  プロパティとして定義します。パース自体は何も汚染せず、返るオブジェクトのプロトタイプは
  常に `Object.prototype` です。

  **重要なのは結果をどう扱うか** です。設定データが own な `__proto__` キーを持ち得ます:

  ```ts
  const data = cfg.toObject()
  { ...data }             // 安全
  structuredClone(data)   // 安全
  Object.assign({}, data) // 危険 — キーが消え、設定データがコピー先のプロトタイプになる
  deepMerge({}, data)     // 危険 — 素朴な再帰マージはグローバルな Object.prototype に書き込み得る
  ```

  いずれも **コピー先** オブジェクトのプロトタイプに起因するため、避けるのは利用側の責務です。
  コピーはスプレッドか `structuredClone`、走査は `Object.entries()` / `Object.keys()` を使い、
  `__proto__` を通常のキー名として扱ってください。制御下にない場所へ渡す場合は
  `cfg.toObject({ nullPrototype: true })` が何も継承しないツリーを返します（ただし利用側が
  素の `{}` にコピーする場合の問題までは解消できません）。

## ライセンス

Apache License 2.0 — [LICENSE](LICENSE) を参照。

Copyright 2026 1o1 Co. Ltd.
