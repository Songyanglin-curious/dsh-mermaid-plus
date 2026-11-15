/**
 * Lift every Mermaid block out of a Markdown document into a test document.
 *
 *   node tools/extract-mermaid.mjs <source.md> <out.md> [--source-label <text>]
 *
 * Blocks are copied verbatim (no re-indent, no re-flow) so a rendering failure
 * points at the original diagram, not at the extractor. Each block keeps the
 * enclosing heading and its 1-based line numbers, which is what the eyeball page
 * (`test/e2e/simforge.html`) reads to label the cards.
 *
 * The output is generated: re-run this instead of editing it by hand.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const [sourcePath, outPath, ...rest] = process.argv.slice(2);
if (sourcePath === undefined || outPath === undefined) {
	console.error('usage: node tools/extract-mermaid.mjs <source.md> <out.md> [--source-label <text>] [--note <text>]');
	process.exit(2);
}
/** Read `--flag value` out of the trailing arguments. */
const option = (name) => {
	const at = rest.indexOf(`--${name}`);
	if (at === -1) return undefined;
	const value = rest[at + 1];
	if (value === undefined || value.startsWith('--')) {
		console.error(`--${name} needs a value`);
		process.exit(2);
	}
	return value;
};
const sourceLabel = option('source-label') ?? basename(sourcePath);
const note = option('note');

const text = await readFile(resolve(sourcePath), 'utf8');
const lines = text.split(/\r?\n/);

/** Block heading: nearest Markdown heading or bold-only label above the fence. */
const headingAt = (index) => {
	for (let i = index, distance = 0; i >= 0 && distance < 40; i -= 1, distance += 1) {
		const line = lines[i].trim();
		if (line === '' || line === '---') continue;
		const heading = /^#{1,6}\s+(.*)$/.exec(line);
		if (heading !== null) return { text: heading[1].trim(), line: i + 1 };
		const bold = /^\*\*(.+?)\*\*[:：]?$/.exec(line);
		if (bold !== null) return { text: bold[1].trim(), line: i + 1 };
	}
	return undefined;
};

const blocks = [];
for (let i = 0; i < lines.length; i += 1) {
	const open = /^```+\s*mermaid\s*$/.exec(lines[i].trim());
	if (open === null) continue;
	const body = [];
	let close = -1;
	for (let j = i + 1; j < lines.length; j += 1) {
		if (/^```+\s*$/.test(lines[j].trim())) {
			close = j;
			break;
		}
		body.push(lines[j]);
	}
	if (close === -1) {
		console.error(`unterminated mermaid fence at line ${i + 1}`);
		process.exit(1);
	}
	const heading = headingAt(i - 1);
	blocks.push({
		heading: heading?.text ?? `图 ${blocks.length + 1}`,
		headingLine: heading?.line ?? null,
		fenceLine: i + 1,
		kind: (body.find((line) => line.trim() !== '') ?? '').trim().split(/\s+/)[0] || 'mermaid',
		body,
	});
	i = close;
}

if (blocks.length === 0) {
	console.error(`no mermaid blocks found in ${sourcePath}`);
	process.exit(1);
}

const out = [
	`# ${basename(sourcePath, '.md')} · Mermaid 图集`,
	'',
	`从 \`${sourceLabel}\` 逐块提炼的 ${blocks.length} 张 Mermaid 图，供 \`test/e2e/simforge.html\` 用出货的 \`client.js\` 渲染验证。`,
	'',
	'> 本文件由 `node tools/extract-mermaid.mjs` 生成，重新提炼时整份覆盖，不要手改图源。',
	'',
	'> 图块内容与原文逐字一致；每块下方标注原文标题与行号（1-based，行号指 ```mermaid 围栏所在行）。',
	...(note === undefined ? [] : ['', `> ${note}`]),
	'',
	'---',
	'',
];
blocks.forEach((block, index) => {
	out.push(`## ${index + 1}. ${block.heading}（${block.kind}）`);
	const where = block.headingLine === null ? `第 ${block.fenceLine} 行` : `第 ${block.fenceLine} 行（小节标题在第 ${block.headingLine} 行）`;
	out.push(`来源：\`${sourceLabel}\` ${where}`);
	out.push('');
	out.push('```mermaid');
	out.push(...block.body);
	out.push('```');
	out.push('');
	out.push('');
});

await writeFile(resolve(outPath), `${out.join('\n')}`, 'utf8');
console.log(`${basename(outPath)}: ${blocks.length} blocks from ${basename(sourcePath)}`);
for (const [index, block] of blocks.entries()) {
	console.log(`  ${index + 1}. ${block.kind.padEnd(15)} line ${String(block.fenceLine).padStart(4)}  ${block.heading}`);
}
