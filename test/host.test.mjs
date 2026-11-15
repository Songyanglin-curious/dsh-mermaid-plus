/**
 * Host-half checks: the vendored-runtime route serves exactly the flat files it
 * owns and nothing else. Run from the plugin root: `node test/host.test.mjs`.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { serveVendorFile, RUNTIME_PATH } from '../index.js';

/** Node response double: records the status line and every byte written. */
function makeResponse() {
	const res = new EventEmitter();
	res.status = null;
	res.headers = null;
	res.bytes = 0;
	res.streamOpen = false;
	res.writeHead = (status, headers) => {
		res.status = status;
		res.headers = headers ?? {};
		return res;
	};
	res.write = (chunk) => {
		res.bytes += Buffer.byteLength(chunk);
		return true;
	};
	res.end = () => {
		res.closed = true;
	};
	res.destroy = () => {
		res.destroyed = true;
	};
	res.on('pipe', (source) => {
		res.streamOpen = true;
		source.on('data', (chunk) => res.write(chunk));
		source.on('end', () => {
			res.streamOpen = false;
		});
		source.on('error', () => {
			res.streamOpen = false;
		});
	});
	return res;
}

/** Await a handler call, including any piped stream body. */
async function call(method, url, headers = {}) {
	const res = makeResponse();
	await serveVendorFile({ method, url, headers }, res);
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline && !(res.closed === true && res.streamOpen === false)) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return res;
}

const runtimeUrl = `${RUNTIME_PATH}/mermaid.esm.min.mjs?v=1`;
const cases = [
	{ name: 'runtime module', method: 'GET', url: runtimeUrl, status: 200, type: 'text/javascript', min: 1_000_000 },
	{ name: 'versioned cache', method: 'GET', url: runtimeUrl, status: 200, check: (res) => (String(res.headers?.['cache-control'] ?? '').includes('immutable') ? '' : 'cache-control is not immutable') },
	{ name: 'unversioned cache', method: 'GET', url: `${RUNTIME_PATH}/mermaid.esm.min.mjs`, status: 200, check: (res) => (res.headers?.['cache-control'] === 'no-cache' ? '' : `cache-control ${res.headers?.['cache-control']}`) },
	{ name: 'etag 304', method: 'GET', url: runtimeUrl, status: 304, check: (res) => (res.bytes === 0 ? '' : `body ${res.bytes}`) },
	{ name: 'gzip body', method: 'GET', url: runtimeUrl, headers: { 'accept-encoding': 'gzip' }, status: 200, check: (res) => {
		if (res.headers?.['content-encoding'] !== 'gzip') return 'missing content-encoding gzip';
		if (!Number(res.headers?.['content-length']) || Number(res.headers['content-length']) >= 2_000_000) return `content-length ${res.headers?.['content-length']}`;
		return '';
	} },
	{ name: 'retired chunk name', method: 'GET', url: `${RUNTIME_PATH}/client.runtime.js`, status: 404 },
	{ name: 'license notice', method: 'GET', url: `${RUNTIME_PATH}/mermaid.LICENSE`, status: 200, type: 'text/plain', min: 100 },
	{ name: 'HEAD runtime', method: 'HEAD', url: `${RUNTIME_PATH}/mermaid.esm.min.mjs`, status: 200, type: 'text/javascript' },
	{ name: 'traversal', method: 'GET', url: `${RUNTIME_PATH}/..%2f..%2fpackage.json`, status: 404 },
	{ name: 'nested path', method: 'GET', url: `${RUNTIME_PATH}/sub/dir.js`, status: 404 },
	{ name: 'unknown name', method: 'GET', url: `${RUNTIME_PATH}/nope.mjs`, status: 404 },
	{ name: 'other extension', method: 'GET', url: `${RUNTIME_PATH}/package.json`, status: 404 },
	{ name: 'bare prefix', method: 'GET', url: `${RUNTIME_PATH}/`, status: 404 },
	{ name: 'outside prefix', method: 'GET', url: '/plugins/other/client.js', status: 404 },
	{ name: 'method not allowed', method: 'POST', url: `${RUNTIME_PATH}/client.runtime.js`, status: 405 },
];

// The 304 case needs the ETag the route actually issued.
const first = await call('GET', runtimeUrl);
cases.find((item) => item.name === 'etag 304').headers = { 'if-none-match': first.headers.etag };

let failures = 0;
for (const item of cases) {
	const res = await call(item.method, item.url, item.headers);
	const type = res.headers?.['content-type'] ?? '';
	const problems = [];
	if (res.status !== item.status) problems.push(`status ${res.status} != ${item.status}`);
	if (item.type !== undefined && !type.startsWith(item.type)) problems.push(`type ${type}`);
	if (item.min !== undefined && res.bytes < item.min) problems.push(`body ${res.bytes} < ${item.min}`);
	if (item.check !== undefined) {
		const problem = item.check(res);
		if (problem !== '') problems.push(problem);
	}
	if (problems.length > 0) failures += 1;
	console.log(
		`${problems.length === 0 ? 'ok  ' : 'FAIL'} ${item.name.padEnd(18)} status=${String(res.status)} type=${type || '-'} bytes=${res.bytes}${problems.length > 0 ? ` -- ${problems.join(', ')}` : ''}`,
	);
}

assert.equal(failures, 0, `${failures} host route case(s) failed`);
console.log('host route: all cases passed');
