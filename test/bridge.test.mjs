import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createBridge } from '../bridge/server.mjs';
import http from 'node:http';

async function fixture(t, timeout = 2000) {
  const token = 'test-token';
  const { server, wss } = createBridge({ token, timeout });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  t.after(async () => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return {
    port, headers,
    request: (path, options = {}) => fetch(`http://127.0.0.1:${port}${path}`, { headers, ...options }),
    connect: async () => { const ws = new WebSocket(`ws://127.0.0.1:${port}/extension?token=${token}`, { origin: `chrome-extension://${'a'.repeat(32)}` }); await once(ws, 'open'); return ws; },
  };
}

test('bridge rejects unauthenticated, web-origin and rebinding requests; reports no browser', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/health', { headers: {} })).status, 401);
  assert.equal((await f.request('/health', { headers: { ...f.headers, Origin: 'https://evil.example' } })).status, 403);
  const rebound = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: f.port, path: '/health', headers: { ...f.headers, Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(rebound, 403);
  assert.deepEqual(await (await f.request('/health')).json(), { connected: false, pending: 0 });
  assert.equal((await f.request('/command', { method: 'POST', body: JSON.stringify({ id: 'request-0001', action: 'tabs.list' }) })).status, 503);
  const rogue = new WebSocket(`ws://127.0.0.1:${f.port}/extension?token=test-token`, { origin: 'https://evil.example' });
  assert.match((await once(rogue, 'error'))[0].message, /403/);
});

test('bridge forwards once per request ID and rejects conflicting ID reuse', async t => {
  const f = await fixture(t);
  const ws = await f.connect();
  let count = 0;
  ws.on('message', raw => { count++; const command = JSON.parse(raw); ws.send(JSON.stringify({ id: command.id, result: { tabId: 42 } })); });
  const body = JSON.stringify({ id: 'request-0001', action: 'tabs.create', url: 'https://github.com' });
  const responses = await Promise.all([f.request('/command', { method: 'POST', body }), f.request('/command', { method: 'POST', body })]);
  for (const response of responses) assert.equal((await response.json()).result.tabId, 42);
  assert.equal(count, 1);
  assert.equal((await f.request('/command', { method: 'POST', body: body.replace('github.com', 'example.com') })).status, 409);
});

test('disconnect marks mutation outcome unknown and deduplicates subsequent retries', async t => {
  const f = await fixture(t);
  const ws = await f.connect();
  ws.on('message', () => ws.close());
  const body = JSON.stringify({ id: 'request-0002', action: 'page.click', tabId: 42, ref: 1 });
  const response = await f.request('/command', { method: 'POST', body });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /outcome unknown/);
  assert.equal((await f.request('/command', { method: 'POST', body })).status, 502);
});

test('timeout preserves the original outcome and status for concurrent retries', async t => {
  const f = await fixture(t, 80);
  await f.connect();
  const body = JSON.stringify({ id: 'request-0003', action: 'page.click', tabId: 42, ref: 1 });
  const responses = await Promise.all([f.request('/command', { method: 'POST', body }), f.request('/command', { method: 'POST', body })]);
  for (const response of responses) { assert.equal(response.status, 504); assert.match((await response.json()).error, /outcome unknown/); }
});
