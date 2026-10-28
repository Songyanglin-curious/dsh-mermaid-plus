/**
 * Build the browser halves of the Mermaid bundle.
 *
 * Run from the workspace root of this plugin (where `node_modules/mermaid`
 * lives): `node build.mjs`.
 *
 * Produces `vendor/mermaid.esm.min.mjs` — Mermaid bundled into ONE file, including
 * every diagram parser, so the browser half can `import()` it from the Host route.
 *
 * The browser half loads this through the Host's own route rather than the
 * client module loader's package-local chunk mechanism: that mechanism addresses
 * a chunk as `/plugins/<id>/<file>`, and a scoped package id (`@scope/name`)
 * contains a `/`, so the Host's chunk route never matches it.
 */
import { build } from 'esbuild';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const mermaidDir = join(root, 'node_modules', 'mermaid');
const version = JSON.parse(readFileSync(join(mermaidDir, 'package.json'), 'utf8')).version;
const esbuild = join(root, 'node_modules', '.bin', 'esbuild');
const vendor = join(root, 'vendor');

// 1. One self-contained ESM bundle: static and dynamic imports both inlined, so
//    the browser needs exactly one request and the runtime needs no import map.
// 使用 JS API，避免 Windows 无法直接执行 .bin 下的 shell 脚本。
await build({
	entryPoints: [join(mermaidDir, 'dist', 'mermaid.esm.min.mjs')],
	bundle: true,
	format: 'esm',
	minify: true,
	target: 'es2022',
	outfile: join(vendor, 'mermaid.esm.min.mjs'),
	logLevel: 'warning',
	legalComments: 'inline',
});

const runtime = readFileSync(join(vendor, 'mermaid.esm.min.mjs'), 'utf8');
const body = runtime.replace(/\/\/#\s*sourceMappingURL=.*$/m, '');
if (/^\s*(?:import|export)\s/m.test(body)) {
	throw new Error('build: the vendored runtime still has bare import/export statements');
}

// 3. License notice travels with the vendored bytes.
copyFileSync(join(mermaidDir, 'LICENSE'), join(vendor, 'mermaid.LICENSE'));

console.log(`build: bundled Mermaid ${version} — runtime ${body.length} B -> vendor/`);
