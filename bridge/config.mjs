import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export const stateDir = process.env.BROWSER_CONTROL_HOME || join(homedir(), '.browser-control');
export const configPath = join(stateDir, 'config.json');
export const pidPath = join(stateDir, 'bridge.pid');
export async function loadConfig() {
  return JSON.parse(await readFile(configPath, 'utf8'));
}
export async function ensureConfig() {
  try { return await loadConfig(); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const config = { port: 47831, token: randomBytes(32).toString('hex') };
  try { await writeFile(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return loadConfig();
}
