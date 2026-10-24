chrome.runtime.sendMessage({ action: 'status' }).then(status => {
  document.getElementById('status').textContent = status.connected ? 'Connected to local agents' : 'Local bridge is offline';
});
