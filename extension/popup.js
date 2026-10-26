const command = 'npx majapi-browser start';

chrome.runtime.sendMessage({ action: 'status' }).then(status => {
  document.getElementById('status').textContent = status.connected ? 'Connected to local agents' : 'Local bridge is offline';
  if (status.connected) return;
  document.getElementById('command').textContent = command;
  document.getElementById('start').hidden = false;
  const copy = document.getElementById('copy');
  copy.addEventListener('click', () => navigator.clipboard.writeText(command).then(() => { copy.textContent = 'Copied'; }));
});
