# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| latest  | ✅        |

## Handling config data safely

### Keys named `__proto__`, `constructor` or `prototype`

This library **preserves** those keys rather than dropping them: a `.properties`
file, an environment namespace or a JSON document may legitimately contain them,
and discarding them is silent data loss (spec item F2.9).

Nothing this library does pollutes a prototype. Every nesting carrier is a
null-prototype object, adapters materialize objects by defining own data
properties, and `toObject()` does the same — so a `__proto__` key from config
arrives as ordinary own data, and the global `Object.prototype` is never
written to.

The risk is in what a consumer does with that data afterwards:

```ts
const data = cfg.toObject()

{ ...data }              // safe
structuredClone(data)    // safe
JSON.parse(JSON.stringify(data))  // safe

Object.assign({}, data)  // UNSAFE: [[Set]] on the plain-object target triggers
                         // Object.prototype's __proto__ setter — the key
                         // disappears and config data becomes the copy's prototype
deepMerge({}, data)      // UNSAFE: a naive recursive merge reads
                         // target['__proto__'], gets Object.prototype, and writes
                         // to it — global prototype pollution
```

Both unsafe patterns take their setter from the **destination** object, so no
option in this library can neutralize them. If you parse untrusted config:

- copy with spread or `structuredClone`, never `Object.assign` into `{}`;
- iterate with `Object.entries()` / `Object.keys()`, not `for...in`;
- use a merge utility that skips `__proto__`/`constructor`/`prototype` when
  writing (most maintained ones do);
- or take `cfg.toObject({ nullPrototype: true })`, whose objects inherit nothing,
  when handing config data to code you do not control.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report vulnerabilities privately via [GitHub Security Advisories](https://github.com/o3co/ts.hocon/security/advisories/new).

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

You will receive a response within 7 days.
