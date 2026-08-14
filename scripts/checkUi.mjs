/**
 * Inspects the running app's rendered DOM over the DevTools protocol.
 * Start the app with a remote debugging port first:
 *   npm start -- --remote-debugging-port=9222
 */
const PORT = Number(process.argv[2] ?? 9222);

const targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((response) => response.json());
const page = targets.find((target) => target.type === 'page');
if (!page) {
  console.error('No page target found. Is the app running with --remote-debugging-port?');
  process.exit(1);
}

console.log(`url:   ${page.url}`);
console.log(`title: ${page.title}`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
  return result.result.value;
};

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', () => reject(new Error('Could not attach to the page')), { once: true });
});

await send('Runtime.enable');

const report = await evaluate(`(() => {
  const root = document.getElementById('root');
  const text = (root?.innerText ?? '').trim();
  return {
    hasBridge: Boolean(window.mixr && window.mixr.isElectron),
    nodeCount: root ? root.querySelectorAll('*').length : 0,
    heading: document.querySelector('.hero h1')?.textContent ?? null,
    panels: document.querySelectorAll('.panel').length,
    vibeChips: document.querySelectorAll('.vibe-chip').length,
    songRows: document.querySelectorAll('.song-row').length,
    buildDisabled: document.querySelector('.generate-button')?.disabled ?? null,
    background: getComputedStyle(document.body).backgroundColor,
    excerpt: text.slice(0, 400),
  };
})()`);

console.log('\n--- rendered ---');
for (const [key, value] of Object.entries(report)) {
  if (key === 'excerpt') continue;
  console.log(`${key.padEnd(14)} ${value}`);
}
console.log('\n--- visible text ---');
console.log(report.excerpt);

socket.close();
process.exit(report.nodeCount > 20 ? 0 : 1);
