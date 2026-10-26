#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { styleText } from 'node:util';
import { ensureConfig, pidPath, stateDir } from '../bridge/config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const extensionDir = join(stateDir, 'extension');

const ok = text => console.log(`${styleText('green', '✓')} ${text}`);
const info = text => console.log(`${styleText('cyan', '›')} ${text}`);
const warn = text => console.log(`${styleText('yellow', '!')} ${text}`);
const dim = text => styleText('dim', text);
const bold = text => styleText('bold', text);

async function health(config) {
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/health`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(1000) });
    return response.ok ? await response.json() : { occupied: true };
  } catch {
    return null;
  }
}

async function start() {
  const config = await ensureConfig();
  let state = await health(config);
  if (state?.occupied) throw new Error(`Port ${config.port} is used by another service.`);
  if (!state) {
    const child = spawn(process.execPath, [join(root, 'bridge/server.mjs')], { detached: true, windowsHide: true, stdio: 'ignore', cwd: root });
    child.unref();
    for (let attempt = 0; attempt < 30 && !state; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      state = await health(config);
    }
    if (!state) throw new Error('The local bridge did not start.');
    ok(`Bridge running on ${bold(`127.0.0.1:${config.port}`)}`);
  } else ok(`Bridge already running on ${bold(`127.0.0.1:${config.port}`)}`);
  if (state.connected) ok('Chrome extension connected');
  else info(`Waiting for the Chrome extension ${dim('(badge turns ON when connected)')}`);
  return config;
}

async function stop() {
  const pid = Number(await readFile(pidPath, 'utf8').catch(() => ''));
  if (!pid) return info('Bridge is not running');
  try { process.kill(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await rm(pidPath, { force: true });
  ok('Bridge stopped');
}

async function status() {
  const config = await ensureConfig();
  const state = await health(config);
  if (!state) {
    warn('Bridge is offline');
    info(`Start it with ${bold('npx majapi-browser start')}`);
    process.exitCode = 1;
    return;
  }
  if (state.occupied) throw new Error(`Port ${config.port} is used by another service.`);
  ok(`Bridge running on ${bold(`127.0.0.1:${config.port}`)}`);
  if (state.connected) ok('Chrome extension connected');
  else warn('Chrome extension not connected');
}

async function setup() {
  const config = await ensureConfig();
  // A stable copy: npx runs packages from a cache Chrome cannot rely on.
  await rm(extensionDir, { recursive: true, force: true });
  await cp(join(root, 'extension'), extensionDir, { recursive: true, filter: source => !source.endsWith('config.local.json') });
  for (const folder of [extensionDir, join(root, 'extension')]) {
    await writeFile(join(folder, 'config.local.json'), JSON.stringify(config), { mode: 0o600 });
  }
  for (const base of ['.agents', '.codex']) {
    const folder = join(homedir(), base, 'skills/browser-control');
    await mkdir(join(folder, 'scripts'), { recursive: true });
    await copyFile(join(root, 'skill/browser-control/SKILL.md'), join(folder, 'SKILL.md'));
    await copyFile(join(root, 'cli/browser.mjs'), join(folder, 'scripts/browser.mjs'));
  }
  ok(`Agent skill installed ${dim('(~/.agents and ~/.codex)')}`);
  ok(`Extension ready at ${bold(extensionDir)}`);
  await start();
  console.log(`\n  Load it once in ${bold('chrome://extensions')} → Developer mode → ${bold('Load unpacked')}.\n  After a restart, run ${bold('npx majapi-browser start')}.\n`);
}

function help() {
  console.log(`${bold('majapi-browser')} ${dim(`v${version}`)}  Control your signed-in Chrome from local agents.

  ${bold('setup')}    Install the extension files and agent skill, then start the bridge
  ${bold('start')}    Start the local bridge in the background
  ${bold('stop')}     Stop the local bridge
  ${bold('status')}   Show bridge and extension status

  ${bold('command')} <json> | --file <path> | --stdin [--out file.png]
           Send a command to the browser ${dim('(used by agents)')}
`);
}

const [name] = process.argv.slice(2);
const commands = { setup, start, stop, status };
try {
  if (!name || name === 'help' || name === '--help' || name === '-h') help();
  else if (name === '--version' || name === '-v') console.log(version);
  else if (commands[name]) await commands[name]();
  else await import('./browser.mjs');
} catch (error) {
  console.error(`${styleText('red', '✗')} ${error.message}`);
  process.exitCode = 1;
}
