import { build } from 'esbuild'

// Bundle the official SDK's internal dependencies so ASAR pruning cannot drop them.
await build({
  entryPoints: ['electron/main.cjs'], outfile: 'electron/main.bundle.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['electron', 'dotenv', 'koffi'],
})
