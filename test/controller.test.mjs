import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../extension/controller.js';

function fixture() {
  const calls = [];
  const tabs = new Map([[1, { id: 1, windowId: 7, groupId: -1 }]]);
  const groups = new Map();
  const api = {
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error('Tab missing'); return tabs.get(id); },
      query: async () => [...tabs.values()],
      create: async options => { const tab = { ...options, id: 2, windowId: 7, groupId: -1 }; tabs.set(2, tab); return tab; },
      group: async options => { calls.push(options); const id = options.groupId ?? 10; for (const tabId of options.tabIds) tabs.get(tabId).groupId = id; return id; },
      update: async (...args) => { calls.push(['update', ...args]); },
      remove: async id => { calls.push(['remove', id]); tabs.delete(id); },
    },
    tabGroups: {
      query: async () => [...groups.values()], get: async id => groups.get(id),
      update: async (id, options) => groups.set(id, { ...options, id }),
    },
    scripting: { executeScript: async () => { calls.push('inject'); return [{ result: 'snapshot' }]; } },
  };
  return { execute: createController(api), calls, tabs, groups };
}

test('unadopted tabs reject reads and mutations; adoption creates a visible AI group', async () => {
  const f = fixture();
  await assert.rejects(f.execute({ action: 'page.snapshot', tabId: 1 }), /AI group/);
  await assert.rejects(f.execute({ action: 'tabs.close', tabId: 1 }), /AI group/);
  assert.deepEqual(f.calls, []);
  await f.execute({ action: 'tabs.adopt', tabId: 1 });
  assert.deepEqual(f.groups.get(10), { id: 10, title: 'AI', color: 'purple', collapsed: false });
  assert.equal(await f.execute({ action: 'page.snapshot', tabId: 1 }), 'snapshot');
  assert.equal((await f.execute({ action: 'tabs.list' }))[0].automated, true);
});

test('new tabs reuse AI and unsupported URLs do not navigate or create tabs', async () => {
  const f = fixture();
  await f.execute({ action: 'tabs.adopt', tabId: 1 });
  await f.execute({ action: 'tabs.create', url: 'https://github.com' });
  assert.equal(f.tabs.get(2).groupId, 10);
  assert.deepEqual(f.calls[1], { tabIds: [2], groupId: 10 });
  await assert.rejects(f.execute({ action: 'tabs.navigate', tabId: 1, url: 'javascript:alert(1)' }), /HTTP/);
  await assert.rejects(f.execute({ action: 'tabs.create', url: 'chrome://settings' }), /HTTP/);
});

test('DOM commands pass serializable optional arguments to Chrome', async () => {
  const f = fixture();
  await f.execute({ action: 'tabs.adopt', tabId: 1 });
  // Chrome rejects undefined inside executeScript.args, unlike JSON.stringify.
  const api = {
    tabs: { get: async () => ({ groupId: 10 }) },
    tabGroups: { get: async () => ({ title: 'AI' }) },
    scripting: { executeScript: async ({ args }) => { assert.deepEqual(args, ['page.click', 4, null, null]); return [{ result: { ok: true } }]; } },
  };
  assert.deepEqual(await createController(api)({ action: 'page.click', tabId: 1, ref: 4 }), { ok: true });
});

test('debugger commands reuse this extension attachment and attach only when needed', async () => {
  let attached = false;
  let attaches = 0;
  const api = {
    tabs: { get: async () => ({ groupId: 10 }) }, tabGroups: { get: async () => ({ title: 'AI' }) },
    debugger: {
      attach: async () => { attaches++; attached = true; },
      sendCommand: async () => { if (!attached) throw new Error('Debugger is not attached to the tab'); return { result: { value: 'ok' } }; },
    },
  };
  const execute = createController(api);
  assert.equal(await execute({ action: 'page.evaluate', tabId: 1, expression: 'document.title' }), 'ok');
  assert.equal(await execute({ action: 'page.evaluate', tabId: 1, expression: 'document.title' }), 'ok');
  assert.equal(attaches, 1);
});
