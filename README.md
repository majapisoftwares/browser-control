# Browser Control

Harness-independent control of your signed-in Chrome using a Manifest V3
extension, an authenticated local bridge, and a portable agent skill. Automated
tabs are grouped under **AI** (purple), including tabs opened by an automated tab.
There are no extension-owned per-action permission dialogs.

Inspired by [Forge Chrome Extension](https://github.com/majapisoftwares/forge-chrome-extension).
Its Manifest V3 service-worker structure is the starting point. This project
controls the actual signed-in tabs instead of exporting cookies to Forge.

## Install

Requires Node 22+ and Chrome 120+.

```powershell
npx majapi-browser setup
```

Setup generates a bridge credential, copies the extension to
`~/.browser-control/extension`, installs the skill in `~/.agents/skills` and
`~/.codex/skills`, and starts the local bridge in the background. Load that folder
once with **Load unpacked** at `chrome://extensions`. No Chrome remote-debugging
port is needed.

```powershell
npx majapi-browser start    # after a restart; the popup shows this when offline
npx majapi-browser status
npx majapi-browser stop
npx majapi-browser command '{"action":"tabs.list"}'
```

From a checkout, `npm ci` then `npm run setup` does the same.

The extension badge shows **ON** when connected. **OFF** means the bridge is
offline; **SET** means local setup is missing. Keep `config.local.json` and
`~/.browser-control/config.json` private. Neither is committed. Run setup
again if you move the extension folder or change its bridge credential.

## Agent access

Read [the portable skill](skill/browser-control/SKILL.md). Any local agent/harness
with shell access can use the CLI or authenticated HTTP API on
`127.0.0.1:47831`. The bridge only binds loopback, rejects web origins and DNS
rebinding hostnames, and authenticates every command. It does not expose a remote
PC-control service. There is no website-to-extension command channel.

Commands cover tabs, DOM snapshots, click/fill/select, JavaScript evaluation,
scrolling, screenshots, trusted keyboard input, and coordinate clicks. Tab actions
are restricted to the AI group; explicitly adopting a tab groups it first.
`tabs.list` can discover existing tabs so agents can choose the correct session.
Concurrent harness commands are serialized in the extension. Recent request IDs
are deduplicated by the bridge; unknown mutation outcomes must be inspected.

The extension controls browser pages, not native Windows applications. It cannot
override a harness's permission policy, Chrome-protected pages, operating-system
dialogs, or browser security. Debugger commands can display Chrome's debugger
information bar. Disable the extension or stop the bridge to disconnect agents.

## Validation

```powershell
npm test
```

Eight tests cover bridge authentication/origin checks, command forwarding and
deduplication, disconnect handling, AI grouping, serializable DOM arguments, and
debugger attachment reuse. Live Chrome validation exercised tab creation in AI,
signed-in GitHub navigation, DOM snapshots, screenshots, and the local Majapi UI
and Cloud pages. Reload the extension after updating its source files.
