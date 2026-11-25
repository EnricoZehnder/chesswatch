// Browser glue: feeds UCI lines from postMessage into the engine and sends its output back.
// An optional "#<url>" on the worker URL says where to load the .wasm from (the apps use the website).
if (self.location.hash.length > 1) {
  const wasmUrl = decodeURIComponent(self.location.hash.slice(1));
  Module.locateFile = (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path);
}
Module.lines = [];
Module.waiter = null;
Module.stopFlag = 0;
Module.ponderHit = 0;
Module.searching = false;
Module.print = (line) => postMessage(line);
Module.printErr = (line) => postMessage('info string ' + line);
Module.nextLine = () =>
  Module.lines.length ? Promise.resolve(Module.lines.shift()) : new Promise((resolve) => (Module.waiter = resolve));
self.onmessage = (e) => {
  const line = String(e.data).trim();
  if (Module.searching) {
    if (line === 'stop') { Module.stopFlag = 1; return; }
    if (line === 'ponderhit') { Module.ponderHit = 1; return; }
    if (line === 'isready') { postMessage('readyok'); return; }
  }
  if (Module.waiter) {
    const w = Module.waiter;
    Module.waiter = null;
    w(line);
  } else {
    Module.lines.push(line);
  }
};
