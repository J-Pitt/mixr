/**
 * Drives the running app's first song row and checks that live search results
 * appear. Requires the app started with --remote-debugging-port.
 */
const PORT = Number(process.argv[2] ?? 9222);
const QUERY = process.argv[3] ?? 'daft punk one more time';

const targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((response) => response.json());
const page = targets.find((target) => target.type === 'page');
if (!page) throw new Error('No page target. Start the app with --remote-debugging-port=9222');

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
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
  }
  return result.result.value;
};

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', () => reject(new Error('attach failed')), { once: true });
});
await send('Runtime.enable');

// React tracks its own value, so the native setter must be used for the change
// to be seen by the component.
await evaluate(`(() => {
  const input = document.querySelector('.song-input-wrap input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(QUERY)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

console.log(`typed: "${QUERY}"`);

const deadline = Date.now() + 25_000;
let results = [];
for (;;) {
  results = await evaluate(`Array.from(document.querySelectorAll('.search-result')).map((node) => node.innerText.replace(/\\n/g, ' | '))`);
  if (results.length > 0 || Date.now() > deadline) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (results.length === 0) {
  const error = await evaluate(`document.querySelector('.row-error')?.innerText ?? 'no results and no error shown'`);
  console.error(`FAILED: ${error}`);
  socket.close();
  process.exit(1);
}

console.log(`\n${results.length} live results:`);
for (const result of results) console.log(`  ${result}`);

// Pick the first result and confirm the row settles into a chosen state.
await evaluate(`document.querySelector('.search-result').click()`);
await new Promise((resolve) => setTimeout(resolve, 400));

const settled = await evaluate(`(() => {
  const chip = document.querySelector('.song-row.settled .song-chip-title');
  return {
    chosen: chip?.textContent ?? null,
    buildDisabled: document.querySelector('.generate-button')?.disabled ?? null,
  };
})()`);

console.log(`\nselected: ${settled.chosen}`);
console.log(`build button enabled: ${!settled.buildDisabled}`);

socket.close();
process.exit(settled.chosen ? 0 : 1);
