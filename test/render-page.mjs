/**
 * Render one of the local eyeball pages in headless Chrome and report its verdict.
 *
 *   node test/render-page.mjs                       # simforge.html (8 mixed diagrams)
 *   node test/render-page.mjs --md=simforge-panorama.md
 *   node test/render-page.mjs --md=simforge-panorama.md --dark --out=docs/simforge-panorama-dark.png
 *
 * The verdict comes from the page's own <title> (`SimForge <n> · ok <k> · fail <f>`),
 * so this measures the shipped bundle in a real browser, not a stub. Pass --out to
 * also write a screenshot; the exit code is 0 only when every diagram rendered.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
	const hit = args.find((value) => value.startsWith(`--${name}=`));
	return hit === undefined ? undefined : hit.slice(name.length + 3);
};
const has = (name) => args.includes(`--${name}`);

const page = flag('page') ?? 'simforge.html';
const query = new URLSearchParams();
if (flag('md') !== undefined) query.set('md', flag('md'));
if (has('dark')) query.set('dark', '');
if (has('source')) query.set('source', '');
const out = flag('out') === undefined ? undefined : resolve(flag('out'));
const [width, height] = (flag('size') ?? '1280x5200').split('x').map(Number);

const win = (...parts) => (process.env.ProgramFiles === undefined ? undefined : join(process.env.ProgramFiles, ...parts));
const candidates = [
	process.env.CHROME_BIN,
	win('Google', 'Chrome', 'Application', 'chrome.exe'),
	win('Microsoft', 'Edge', 'Application', 'msedge.exe'),
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'google-chrome',
	'chromium',
].filter((value) => typeof value === 'string' && value !== '');
const browser = candidates.find((candidate) => {
	if (candidate.includes('/') && !existsSync(candidate)) return false;
	try {
		execFileSync(candidate, ['--version'], { stdio: 'ignore', timeout: 15_000 });
		return true;
	} catch {
		return false;
	}
});
if (browser === undefined) {
	console.error('render: no Chrome/Chromium found. Set CHROME_BIN to run this.');
	process.exit(2);
}

const port = 8800 + Math.floor(Math.random() * 80);
const server = spawn(process.execPath, [join(import.meta.dirname, 'serve-e2e.mjs'), String(port)], { stdio: 'ignore' });
const url = `http://127.0.0.1:${port}/${page}${query.toString() === '' ? '' : `?${query}`}`;

const profileDir = await mkdtemp(join(tmpdir(), 'dsh-mermaid-page-'));
const baseArgs = ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--virtual-time-budget=120000', `--user-data-dir=${profileDir}`];

try {
	for (let i = 0; i < 75; i += 1) {
		try {
			if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
		} catch {
			/* not up yet */
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}

	const dom = execFileSync(browser, [...baseArgs, '--dump-dom', url], {
		encoding: 'utf8',
		timeout: 180_000,
		maxBuffer: 128 * 1024 * 1024,
	});
	const title = /<title>([^<]*)<\/title>/.exec(dom)?.[1]?.trim() ?? '';
	const verdict = /^SimForge (\d+) · ok (\d+) · fail (\d+)$/.exec(title);
	if (verdict === null) {
		console.error(`render: no verdict (title: ${JSON.stringify(title)})`);
		const failed = [...dom.matchAll(/class="dsh-mdm-err"[^>]*>([\s\S]*?)</g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
		for (const text of failed.slice(0, 5)) console.error(`  ${text.split('\n')[0]}`);
		process.exit(1);
	}

	const [, total, ok, failed] = verdict.map(Number);
	console.log(`${page}${query.toString() === '' ? '' : `?${query}`}: ${ok}/${total} rendered, ${failed} failed`);
	if (failed > 0) {
		const errors = [...dom.matchAll(/class="dsh-mdm-err"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
		for (const [index, text] of errors.entries()) console.log(`  fail ${index + 1}: ${text.split('\n').slice(0, 4).join(' / ').slice(0, 400)}`);
	}

	if (out !== undefined) {
		execFileSync(browser, [...baseArgs, `--window-size=${width},${height}`, `--screenshot=${out}`, url], { timeout: 180_000 });
		console.log(`screenshot: ${out}`);
	}
	process.exit(failed === 0 ? 0 : 1);
} finally {
	server.kill('SIGTERM');
	await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}
