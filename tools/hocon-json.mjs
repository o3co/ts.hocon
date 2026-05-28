// ts.hocon adapter for the cross-impl differential harness (xx.hocon/generate).
// Parses+resolves a HOCON file and prints the resolved tree as canonical JSON
// to stdout. On any parse/resolve error (including a failure to load the built
// bundle) it prints a single-line {"__error__":{"type":..,"message":..}} record
// to stdout and sets exit code 3, so the differential driver can compare
// error-vs-success behaviour uniformly across go/rs/ts and the Lightbend oracle.
//
// Usage: node tools/hocon-json.mjs <conf-file>   (after `pnpm build`)
//
// Plain ESM (.mjs) — no TypeScript type stripping — so it runs on the repo's
// declared Node floor (engines.node >=22), not only Node >= 23.6. It imports
// the built bundle dynamically inside the try/catch, so a missing/invalid dist
// still yields the single-line error record rather than an uncaught module-load
// stack trace. Env substitutions resolve against the process environment; the
// driver controls hermeticity by clearing/setting the subprocess env.

const EXIT_ERROR = 3

async function main() {
  const file = process.argv[2]
  if (file === undefined) {
    console.error('usage: hocon-json <conf-file>')
    process.exitCode = 2
    return
  }
  try {
    const { parseFile } = await import('../dist/index.js')
    const cfg = parseFile(file)
    // process.stdout.write (vs console.log + process.exit) lets the event loop
    // drain stdout before the process ends, avoiding truncation when piped.
    process.stdout.write(cfg._renderJSONForTest() + '\n')
  } catch (e) {
    const type = e?.constructor?.name ?? 'Error'
    const message = e instanceof Error ? e.message : String(e)
    process.stdout.write(JSON.stringify({ __error__: { type, message } }) + '\n')
    process.exitCode = EXIT_ERROR
  }
}

main()
