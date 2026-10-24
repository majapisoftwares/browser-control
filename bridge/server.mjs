import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { ensureConfig } from './config.mjs';

export function createBridge({ token, timeout = 30_000 }) {
  let browser;
  const pending = new Map();
  const seen = new Map();
  const matches = value => typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token)
    && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const send = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    // Web pages never receive CORS access; DNS rebinding and browser-origin requests are rejected.
    if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '') || req.headers.origin) return send(res, 403, { error: 'Local clients only' });
    if (!matches(req.headers.authorization?.replace(/^Bearer /, ''))) return send(res, 401, { error: 'Unauthorized' });
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { connected: browser?.readyState === WebSocket.OPEN, pending: pending.size });
    if (req.method !== 'POST' || req.url !== '/command') return send(res, 404, { error: 'Not found' });
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 1_048_576) return send(res, 413, { error: 'Command too large' });
      }
      const command = JSON.parse(body);
      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(command.id || '') || typeof command.action !== 'string') return send(res, 400, { error: 'id and action required' });
      const prior = seen.get(command.id);
      if (prior) {
        if (prior.body !== body) return send(res, 409, { error: 'Request ID already used for another command' });
        const outcome = await prior.result;
        return send(res, prior.status, outcome);
      }
      if (browser?.readyState !== WebSocket.OPEN) return send(res, 503, { error: 'Chrome extension is not connected' });
      if (pending.size >= 100) return send(res, 429, { error: 'Too many commands' });
      let resolve;
      const result = new Promise(r => { resolve = r; });
      const entry = { body, status: 200, result };
      seen.set(command.id, entry);
      const timer = setTimeout(() => {
        pending.delete(command.id);
        entry.status = 504;
        resolve({ id: command.id, error: 'Timed out; outcome unknown. Do not repeat mutations with a new ID.' });
      }, timeout);
      pending.set(command.id, { resolve, timer, entry });
      browser.send(JSON.stringify(command));
      const outcome = await result;
      // Keep bounded idempotency history, including failures and unknown outcomes.
      if (seen.size > 2000) for (const id of seen.keys()) {
        if (!pending.has(id)) { seen.delete(id); break; }
      }
      return send(res, entry.status, outcome);
    } catch { return send(res, 400, { error: 'Invalid command' }); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '') || !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || '') || url.pathname !== '/extension' || !matches(url.searchParams.get('token'))) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    if (browser?.readyState === WebSocket.OPEN) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    browser = ws;
    ws.on('message', data => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      const item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(message.id);
      item.resolve(message);
    });
    ws.on('close', () => {
      if (browser === ws) browser = undefined;
      for (const [id, item] of pending) {
        clearTimeout(item.timer); item.entry.status = 502;
        item.resolve({ id, error: 'Browser disconnected; outcome unknown. Do not repeat mutations with a new ID.' });
      }
      pending.clear();
    });
  });
  return { server, wss };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = await ensureConfig();
  const { server } = createBridge(config);
  server.listen(config.port, '127.0.0.1', () => console.log(`Browser Control listening on 127.0.0.1:${config.port}`));
}
