import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ensureConfig } from '../bridge/config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const config = await ensureConfig();
await writeFile(join(root, 'extension/config.local.json'), JSON.stringify(config), { mode: 0o600 });
for (const base of ['.agents', '.codex']) {
  const folder = join(homedir(), base, 'skills/browser-control');
  await mkdir(join(folder, 'scripts'), { recursive: true });
  await copyFile(join(root, 'skill/browser-control/SKILL.md'), join(folder, 'SKILL.md'));
  await copyFile(join(root, 'cli/browser.mjs'), join(folder, 'scripts/browser.mjs'));
}
try {
  const health = await fetch(`http://127.0.0.1:${config.port}/health`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(1000) });
  if (!health.ok) throw new Error('Port is occupied by another service');
} catch (error) {
  if (error.message === 'Port is occupied by another service') throw error;
  const child = spawn(process.execPath, [resolve(root, 'bridge/server.mjs')], { detached: true, windowsHide: true, stdio: 'ignore', cwd: root });
  child.unref();
}
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/health`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(1000) });
    if (response.ok) { ready = true; break; }
  } catch { /* Wait for the child process to bind its port. */ }
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!ready) throw new Error('Local bridge did not become ready');
console.log(`Extension prepared: ${join(root, 'extension')}\nSkill installed in ~/.agents/skills and ~/.codex/skills.\nLocal bridge configured on 127.0.0.1:${config.port}. No token is printed.`);
