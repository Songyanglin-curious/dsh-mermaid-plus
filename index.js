import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * Host half of the Mermaid diagram bundle.
 *
 * The browser half renders diagrams, but it may not import Mermaid itself: a
 * client bundle resolves only the frozen platform module table. This half owns
 * the one thing the browser cannot do — serve the vendored Mermaid release as a
 * plain static asset — so the browser half can `import()` it from the page's own
 * origin. Nothing here is model-facing and nothing is injected into a prompt.
 *
 * @module dsh-mermaid-plus
 */

/** Own manifest; the package name is read once and every runtime name derives from it. */
const MANIFEST = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** Package name, as the Loader row and the client module graph know it. */
const PKG_NAME = MANIFEST.name;

/**
 * Public route prefix, derived from the package name so two diagram plugins can be
 * installed side by side (a duplicate prefix route would throw). The browser half
 * derives the same value from its own copy of the name; keep the formulas identical.
 */
export const RUNTIME_PATH = `/x-${PKG_NAME.replace(/^@/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

/** Directory holding the built Mermaid release, resolved beside this file. */
const VENDOR_DIR = fileURLToPath(new URL('./vendor/', import.meta.url));

/** Media types for the files this route may serve. */
const MIME = {
	'.mjs': 'text/javascript; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.license': 'text/plain; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
};

/**
 * The isolated renderer, served beside the vendored runtime. The browser half
 * puts these in an iframe so Mermaid measures text in a document that has no
 * app stylesheet — the difference between a fast render and a frozen tab.
 */
const RENDERER_DIR = fileURLToPath(new URL('./renderer/', import.meta.url));

/** Vendored names this route exposes: one flat, browser-safe file name each. */
const ALLOWED = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:mjs|js|map|txt|html|LICENSE|license)$/;

/**
 * Media types the browser half fetches on a cold page: gzipped once and kept
 * around, because the Mermaid runtime is 5 MB and every session asks for it.
 */
const COMPRESSIBLE = new Set(['.mjs', '.js', '.map', '.txt', '.license']);

/** Gzipped bodies keyed by file, invalidated by size+mtime. At most a few MB. */
const COMPRESSED = new Map();
const COMPRESSED_LIMIT = 4;

/** Gzip one vendored file, reusing the previous body until the file changes. */
async function gzippedBody(target, info) {
	const revision = `${info.size}:${Math.floor(info.mtimeMs)}`;
	const cached = COMPRESSED.get(target);
	if (cached !== undefined && cached.revision === revision) return cached.body;
	const body = gzipSync(await readFile(target), { level: 6 });
	if (COMPRESSED.size >= COMPRESSED_LIMIT) COMPRESSED.clear();
	COMPRESSED.set(target, { revision, body });
	return body;
}

/**
 * Serve one vendored runtime file by name.
 *
 * The URL carries `?v=<runtime version>`, so a versioned request can be cached
 * forever; a request without it keeps revalidating by ETag instead. Gzip is
 * offered for the big JavaScript bodies — on loopback the transfer is fast, but
 * the browser still parses whatever it receives, and the compressed form is a
 * third of the size.
 * @param request - Node HTTP request under the route prefix.
 * @param response - Node HTTP response.
 */
export async function serveVendorFile(request, response) {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
		response.end('Method Not Allowed');
		return;
	}
	let pathname;
	let versioned;
	try {
		const url = new URL(request.url ?? '/', 'http://dsh.invalid');
		pathname = decodeURIComponent(url.pathname);
		versioned = url.searchParams.has('v');
	} catch {
		response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
		response.end('Bad Request');
		return;
	}
	const relative = pathname.startsWith(`${RUNTIME_PATH}/`) ? pathname.slice(RUNTIME_PATH.length + 1) : '';
	if (relative === '' || relative.includes('/') || !ALLOWED.test(relative) || relative.includes(sep)) {
		response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
		response.end('Not Found');
		return;
	}
	const fromRenderer = relative === 'renderer.html' || relative === 'renderer-frame.js';
	const target = fromRenderer ? join(RENDERER_DIR, relative) : join(VENDOR_DIR, relative);
	let info;
	try {
		info = await stat(target);
	} catch {
		response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
		response.end('Not Found');
		return;
	}
	if (!info.isFile()) {
		response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
		response.end('Not Found');
		return;
	}
	const extension = extname(target).toLowerCase();
	const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
	const headers = {
		'content-type': MIME[extension] ?? 'application/octet-stream',
		'cache-control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
		etag,
		'x-content-type-options': 'nosniff',
	};

	const ifNoneMatch = request.headers?.['if-none-match'];
	if (typeof ifNoneMatch === 'string' && (ifNoneMatch === '*' || ifNoneMatch.split(',').some((tag) => tag.trim() === etag))) {
		response.writeHead(304, headers);
		response.end();
		return;
	}

	const acceptsGzip = typeof request.headers?.['accept-encoding'] === 'string' && /\bgzip\b/.test(request.headers['accept-encoding']);
	const gzip = acceptsGzip && COMPRESSIBLE.has(extension) && info.size > 1024;
	if (gzip) {
		const body = await gzippedBody(target, info);
		headers['content-encoding'] = 'gzip';
		headers.vary = 'accept-encoding';
		headers['content-length'] = String(body.length);
		if (request.method === 'HEAD') {
			response.writeHead(200, headers);
			response.end();
			return;
		}
		response.writeHead(200, headers);
		response.write(body);
		response.end();
		return;
	}

	headers['content-length'] = String(info.size);
	if (request.method === 'HEAD') {
		response.writeHead(200, headers);
		response.end();
		return;
	}
	response.writeHead(200, headers);
	const stream = createReadStream(target);
	stream.on('error', () => response.destroy());
	stream.pipe(response);
}

/** Host services this half needs before it can mount its route. */
export const inject = ['webServer'];

/**
 * Absolute path of the diagnostic log. It lives in the OS temp directory, not in
 * the package: an installed package may be read-only, and a published plugin must
 * not write into `node_modules`.
 */
const DIAG_DIR = join(tmpdir(), PKG_NAME.replace(/^@/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase());
const DIAG_FILE = join(DIAG_DIR, 'report.json');
/** The Host half's own activation dump, separate from the browser's event log. */
const ACTIVATION_FILE = join(DIAG_DIR, 'activation.json');

/** Cap the diagnostic log so a long session cannot grow the file without bound. */
const DIAG_LIMIT = 200;

/**
 * Read a JSON request body, bounded and never throwing.
 * @param request - Node HTTP request.
 * @param limit - maximum accepted byte count.
 * @returns the parsed value or undefined.
 */
async function readJsonBody(request, limit) {
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > limit) return undefined;
		chunks.push(chunk);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		return undefined;
	}
}

/**
 * Read the diagnostic log. Older builds wrote one object instead of an array;
 * accepting both keeps a running Host compatible with either shape.
 */
function readDiagnostics() {
	try {
		const parsed = JSON.parse(readFileSync(DIAG_FILE, 'utf8'));
		if (Array.isArray(parsed)) return parsed;
		return typeof parsed === 'object' && parsed !== null ? [parsed] : [];
	} catch {
		return [];
	}
}

/**
 * Append one browser-half report to the diagnostic log next to this package.
 *
 * The browser half runs in a renderer whose console is not reachable from here,
 * so a silent failure there is invisible to the Host. This is the one channel
 * that closes that gap: the browser half posts what it did, and the report lands
 * on disk. Best effort — a diagnostic must never break activation.
 * @param request - Node HTTP request carrying the report.
 * @param response - Node HTTP response.
 */
async function receiveReport(request, response) {
	if (request.method !== 'POST') {
		response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' });
		response.end('Method Not Allowed');
		return;
	}
	const body = await readJsonBody(request, 1_000_000);
	const entries = readDiagnostics();
	entries.push({
		...(typeof body === 'object' && body !== null ? body : { raw: body }),
		receivedAt: new Date().toISOString(),
	});
	try {
		await mkdir(DIAG_DIR, { recursive: true });
		await writeFile(DIAG_FILE, `${JSON.stringify(entries.slice(-DIAG_LIMIT), null, 2)}\n`);
		response.writeHead(204, { 'cache-control': 'no-store' });
		response.end();
	} catch (error) {
		response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
		response.end(String(error));
	}
}

/**
 * Write one diagnostic dump of what the Host sees for this plugin.
 *
 * The Host half and the browser half fail in different places, and neither
 * failure is visible from the other side; this records both views at activation
 * so a report of "nothing happens" can be attributed without guessing. Best
 * effort: a diagnostic must never break activation.
 * @param ctx - Host plugin context.
 */
async function dumpDiagnostics(ctx) {
	try {
		// The client-module graph is composed after plugins mount, so an immediate
		// read sees nothing. One short delay makes the dump answer the question it
		// exists for: is this package's browser row in the graph?
		await new Promise((resolve) => setTimeout(resolve, 2500).unref?.());
		const clientModules = ctx.get('clientModules');
		const graph = clientModules?.graph?.();
		const table = clientModules?.table;
		const payload = {
			at: new Date().toISOString(),
			package: PKG_NAME,
			activated: true,
			runtimePath: RUNTIME_PATH,
			vendorDir: VENDOR_DIR,
			graphEntries: Array.isArray(graph?.entries) ? graph.entries.map((entry) => entry.id) : null,
			batches: Array.isArray(graph?.batches)
				? graph.batches.map((batch) => ({ phase: batch.phase, entries: batch.entries }))
				: null,
			ownEntry: Array.isArray(graph?.entries)
				? (graph.entries.find((entry) => entry.id === PKG_NAME) ?? null)
				: null,
			clientPath: clientModules?.clientPath?.(PKG_NAME) ?? null,
			loaderEntries: (() => {
				try {
					return ctx.loader.entries().map((entry) => entry.options?.name ?? null);
				} catch {
					return null;
				}
			})(),
		};
		await mkdir(DIAG_DIR, { recursive: true });
		await writeFile(ACTIVATION_FILE, `${JSON.stringify(payload, null, 2)}\n`);
	} catch (error) {
		ctx.logger?.warn?.(`dsh-mermaid: diagnostics failed: ${String(error)}`);
	}
}

/**
 * Mount the vendored-runtime route.
 *
 * A throw here would otherwise read as "the entry did not activate" with no
 * detail on this side, so the failure is logged against the plugin before it
 * propagates.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
	try {
		ctx.effect(
			() =>
				ctx.webServer.register({
					kind: 'prefix',
					path: RUNTIME_PATH,
					handler: serveVendorFile,
				}),
			'dsh-mermaid: vendored runtime route',
		);
		ctx.effect(
			() =>
				ctx.webServer.register({
					kind: 'exact',
					path: `${RUNTIME_PATH}/__report`,
					handler: receiveReport,
				}),
			'dsh-mermaid: browser-half report sink',
		);
		// One unconditional activation line. Without it a silent client-side
		// failure is indistinguishable from a Host half that never mounted, and
		// the two need different fixes.
		ctx.logger?.info?.(`dsh-mermaid: vendored runtime mounted at ${RUNTIME_PATH}/`);
		void dumpDiagnostics(ctx);
	} catch (error) {
		ctx.logger?.error?.(`dsh-mermaid: mounting ${RUNTIME_PATH} failed`, error);
		throw error;
	}
}
