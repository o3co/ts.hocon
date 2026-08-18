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
  splitting: false,
})
