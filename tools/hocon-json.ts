// ts.hocon adapter for the cross-impl differential harness (xx.hocon/generate).
// Parses+resolves a HOCON file and prints the resolved tree as canonical JSON
// to stdout. On any parse/resolve error it prints a single-line
// {"__error__":{"type":..,"message":..}} record to stdout and exits 3, so the
// differential driver can compare error-vs-success behaviour uniformly across
// go/rs/ts and the Lightbend oracle.
//
// Usage: node tools/hocon-json.ts <conf-file>   (after `pnpm build`)
//
// Imports the built bundle so Node's type stripping (Node >= 23.6) only has to
// strip this entry file; the source's `.js`-suffixed internal imports are not
// resolvable directly. Environment substitutions resolve against the process
// environment, so the driver controls hermeticity by clearing/setting the
// subprocess env.

import { parseFile } from '../dist/index.js'

const EXIT_ERROR = 3

const file = process.argv[2]
if (file === undefined) {
  console.error('usage: hocon-json <conf-file>')
  process.exit(2)
}

try {
  const cfg = parseFile(file)
  console.log(cfg._renderJSONForTest())
} catch (e) {
  const type = (e as { constructor?: { name?: string } })?.constructor?.name ?? 'Error'
  const message = e instanceof Error ? e.message : String(e)
  console.log(JSON.stringify({ __error__: { type, message } }))
  process.exit(EXIT_ERROR)
}
