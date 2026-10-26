async function startCommand() {
  // Written by `npm run setup`; older installs have no root.
  const config = await fetch(chrome.runtime.getURL('config.local.json')).then(response => response.json()).catch(() => ({}));
  return config.root ? `cd "${config.root}" && npm run setup` : 'npm run setup  # in the browser-control folder';
}

chrome.runtime.sendMessage({ action: 'status' }).then(async status => {
  document.getElementById('status').textContent = status.connected ? 'Connected to local agents' : 'Local bridge is offline';
  if (status.connected) return;
  const command = await startCommand();
  document.getElementById('command').textContent = command;
  document.getElementById('start').hidden = false;
  const copy = document.getElementById('copy');
  copy.addEventListener('click', () => navigator.clipboard.writeText(command).then(() => { copy.textContent = 'Copied'; }));
});
