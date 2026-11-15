/**
 * Renderer half of the sandbox: Mermaid in a document that holds nothing else.
 *
 * The parent posts `{ type: 'dsh-mdm-render', id, source, dark }`; this replies
 * with `{ type: 'dsh-mdm-rendered', id, svg, ms }` or `{ type: 'dsh-mdm-rendered', id, error }`.
 * One render at a time, because Mermaid's configuration is global.
 */
import mermaid from './mermaid.esm.min.mjs';

const queue = [];
let busy = false;

/** The parent is same-origin; anything else is ignored. */
const isParent = (event) => event.source === window.parent && event.origin === window.location.origin;

function configure(dark) {
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: 'strict',
		layout: 'elk',
		look: 'neo',
		htmlLabels: false,
		flowchart: { htmlLabels: false },
		theme: dark ? 'redux-dark-color' : 'redux-color',
		fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
		deterministicIds: false,
		logLevel: 'fatal',
	});
}

async function pump() {
	if (busy) return;
	busy = true;
	while (queue.length > 0) {
		const job = queue.shift();
		const started = performance.now();
		try {
			configure(job.dark === true);
			const result = await mermaid.render(`dsh-mdm-sandbox-${job.id}`, job.source);
			window.parent.postMessage(
				{ type: 'dsh-mdm-rendered', id: job.id, svg: result.svg, ms: Math.round(performance.now() - started) },
				window.location.origin,
			);
		} catch (error) {
			window.parent.postMessage(
				{ type: 'dsh-mdm-rendered', id: job.id, error: String(error?.message ?? error).slice(0, 400) },
				window.location.origin,
			);
		}
	}
	busy = false;
}

window.addEventListener('message', (event) => {
	if (!isParent(event)) return;
	const data = event.data;
	if (data === null || typeof data !== 'object' || data.type !== 'dsh-mdm-render') return;
	if (typeof data.source !== 'string' || typeof data.id !== 'number') return;
	queue.push({ id: data.id, source: data.source, dark: data.dark === true });
	void pump();
});

window.parent.postMessage({ type: 'dsh-mdm-ready' }, window.location.origin);
