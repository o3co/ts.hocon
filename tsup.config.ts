import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    zod: 'src/zod.ts',
    'adapters/properties': 'src/adapters/properties.ts',
    'adapters/env': 'src/adapters/env.ts',
    'adapters/jsonc': 'src/adapters/jsonc.ts',
    'adapters/json5': 'src/adapters/json5.ts',
    'adapters/toml': 'src/adapters/toml.ts',
    'adapters/yaml': 'src/adapters/yaml.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  // Splitting puts the shared code (Config, the error classes, the parser) in
  // chunks every entrypoint imports, so a value or error from `/zod` or
  // `/adapters/*` is an instance of the classes `@o3co/ts.hocon` exports.
  // Without it each bundle carries its own copy and `instanceof` fails across
  // entrypoints. Splitting the CJS output is experimental in tsup;
  // tools/smoke-entrypoints.mjs checks load, use and `instanceof` in both
  // formats on every CI run.
  splitting: true,
  // With CJS splitting, `import.meta` reaches the CJS chunk unchanged (a
  // SyntaxError at load). tsup's `shims` would replace it with a URL built from
  // `__filename` at chunk load, which a browser bundler consuming the CJS
  // output does not provide, so every entrypoint crashed there. Instead the CJS
  // build reads `import.meta.url` as undefined: the include loader uses the
  // real `require` in CJS and only falls back to the URL (src/internal/
  // resolver/include-loader.ts), so nothing is lost.
  esbuildOptions(options, context) {
    if (context.format === 'cjs') {
      options.define = { ...options.define, 'import.meta.url': 'undefined' }
    }
  },
})
