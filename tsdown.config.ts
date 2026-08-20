/**
 * Dual-face bundle for dsh-selection-highlight.
 *
 * The client artifact follows the dsh client module-loader contract used by
 * packages/client/tsdown.client.ts: a classic script that calls
 * `window.__ModuleLoader__.load({ id, factory })` and resolves externals
 * through the injected `require`. React stays external because the web shell
 * seeds it into the platform module table.
 */
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-selection-highlight'

const CLIENT_EXTERNALS = ['react']

const clientBundle: UserConfig = {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(PLUGIN_ID) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}

/** Host half: a nearly empty ESM bundle so the row is a valid dual-face package. */
const hostBundle: UserConfig = {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    alwaysBundle: (id: string) => !id.startsWith('node:'),
  },
  outputOptions: {
    entryFileNames: 'index.js',
  },
}

export default [hostBundle, clientBundle] satisfies UserConfig[]
