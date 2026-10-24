#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
let requestId;
if (!args.length || args.includes('--help')) {
  console.log('browser.mjs status | command <JSON> | --file <command.json> | --stdin [--out screenshot.png]\nCommands: tabs.list/create/adopt/navigate/reload/close; page.snapshot/click/fill/select/scroll/evaluate/screenshot/type/key/clickAt/detach');
  process.exit(0);
}
try {
  const config = JSON.parse(await readFile(join(process.env.BROWSER_CONTROL_HOME || join(homedir(), '.browser-control'), 'config.json'), 'utf8'));
  const options = { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(35_000) };
  const status = args[0] === 'status';
  let command;
  if (!status) {
    let input;
    if (args[0] === '--file') input = await readFile(args[1], 'utf8');
    else if (args[0] === '--stdin') { input = ''; for await (const chunk of process.stdin) input += chunk; }
    else input = args[0] === 'command' ? args[1] : args[0];
    command = { ...JSON.parse(input) };
    command.id ||= randomUUID();
    requestId = command.id;
    options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(command);
  }
  const response = await fetch(`http://127.0.0.1:${config.port}/${status ? 'health' : 'command'}`, options);
  const result = await response.json();
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0 && result.result?.data) {
    await writeFile(args[outIndex + 1], Buffer.from(result.result.data, 'base64'));
    result.result = { path: args[outIndex + 1], format: 'png' };
  }
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok || result.error) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ id: requestId, error: error.message, outcome: 'If a command was sent, its outcome may be unknown. Inspect before retrying.' }));
  process.exitCode = 1;
}
