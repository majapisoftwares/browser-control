import { createController } from './controller.js';

const execute = createController(chrome);
let socket;
let heartbeat;
let connecting = false;
let queue = Promise.resolve();

async function connect() {
  if (connecting || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  connecting = true;
  try {
    const config = await (await fetch(chrome.runtime.getURL('config.local.json'))).json();
    socket = new WebSocket(`ws://127.0.0.1:${config.port}/extension?token=${encodeURIComponent(config.token)}`);
    socket.onopen = () => {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#6d28d9' });
      clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
      }, 20_000);
    };
    socket.onmessage = event => {
      let command;
      try { command = JSON.parse(event.data); } catch { return; }
      if (command.type === 'pong') return;
      const channel = socket;
      // Serialize actions across all harnesses, including commands that focus a tab.
      queue = queue.then(async () => {
        let response;
        try { response = { id: command.id, result: await execute(command) }; }
        catch (error) { response = { id: command.id, error: error.message }; }
        if (channel.readyState === WebSocket.OPEN) channel.send(JSON.stringify(response));
      }).catch(() => {});
    };
    socket.onclose = () => {
      clearInterval(heartbeat);
      chrome.action.setBadgeText({ text: 'OFF' });
      setTimeout(connect, 2000);
    };
    socket.onerror = () => socket.close();
  } catch {
    chrome.action.setBadgeText({ text: 'SET' });
  } finally { connecting = false; }
}
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('reconnect', { periodInMinutes: 0.5 }); connect(); });
chrome.runtime.onStartup.addListener(connect);
chrome.alarms.onAlarm.addListener(connect);
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.action === 'status') {
    respond({ connected: socket?.readyState === WebSocket.OPEN }); return false;
  }
});
// New tabs opened by an automated tab belong to its AI group as well.
chrome.tabs.onCreated.addListener(async tab => {
  if (!tab.openerTabId) return;
  try {
    const parent = await chrome.tabs.get(tab.openerTabId);
    if (parent.groupId < 0 || (await chrome.tabGroups.get(parent.groupId)).title !== 'AI') return;
    await chrome.tabs.group({ tabIds: [tab.id], groupId: parent.groupId });
  } catch { /* The opener may have closed. */ }
});
connect();
