# OpenCode Configuration

[![Last commit](https://img.shields.io/github/last-commit/countzero/opencode_config)](https://github.com/countzero/opencode_config/commits/main) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![GitHub Sponsors](https://img.shields.io/github/sponsors/countzero?label=Sponsor&logo=GitHub)](https://github.com/sponsors/countzero) [![Ko-fi](https://img.shields.io/badge/Ko--fi-Tip-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/finnkumkar)

My global configuration for [OpenCode](https://opencode.ai) on Windows, published so others can take single plugins and skills. The repository is the `~/.config/opencode` directory itself, so OpenCode reads it in place.

## Contents

| Path                            | What it does                                        | Runs on |
| ------------------------------- | --------------------------------------------------- | ------- |
| `plugins/todo-state.js`         | Re-states the open todo list on every step          | any     |
| `plugins/llama-limits.js`       | Fills llama-server providers from their presets     | any     |
| `plugins/chrome-slot.js`        | Gives every OpenCode process its own Chrome profile | Windows |
| `tui-plugins/slot-title.js`     | Shows the Chrome slot in the terminal title         | Windows |
| `.opencode/skills/plan-review/` | Second-pass design review of a plan                 | any     |
| `.opencode/skills/trim-prose/`  | Tightens the comments and docs a branch changes     | bash    |
| `opencode.json`                 | Models, agents, permissions, MCP servers, providers | Windows |
| `tui.json`                      | Theme and the TUI plugin                            | any     |
| `AGENTS.md`                     | Rules loaded into every session                     | any     |

## Reuse a Plugin or Skill

Every plugin states how to install it in its header comment. A skill directory goes into `~/.config/opencode/skills/` to load in every project, or into a project's `.opencode/skills/` to load only there; here the skills sit in `.opencode/skills/`, so they load only when OpenCode runs inside this directory.

The plugins are tested against OpenCode 1.18.32, which `"autoupdate": false` keeps in place. `todo-state.js` relies on an experimental hook and `slot-title.js` patches the renderer, so a newer release can break either. On Linux and macOS, `chrome-slot.js` claims a localhost port instead of a named pipe; that path is not yet tested end to end.

## Install the Whole Configuration

This replaces your own configuration and assumes my setup: Windows, the MCP servers in `opencode.json`, and llama-server hosts on my network.

### 1. Install Prerequisites

Download and install the latest versions:

* [Git](https://git-scm.com/download)
* [Node.js LTS](https://nodejs.org/en/download), installed to `C:\Program Files\nodejs`, whose `npx` starts the `chrome-devtools` MCP server
* [OpenCode](https://opencode.ai/docs/#install)
* [Chromium](https://www.chromium.org/getting-involved/download-chromium/), installed per user to `C:\Users\<name>\AppData\Local\Chromium`

### 2. Clone the repository from GitHub

Move an existing configuration aside, then clone the repository into its place:

```PowerShell
Rename-Item "$HOME\.config\opencode" "opencode.backup" -ErrorAction SilentlyContinue
git clone https://github.com/countzero/opencode_config.git "$HOME\.config\opencode"
```

### 3. Add the secrets

Secrets never enter the repository. `opencode.json` reads them from files under `~/.secrets` via `{file:…}`:

| File                         | Used by                                      |
| ---------------------------- | -------------------------------------------- |
| `~/.secrets/windows-mcp-key` | Bearer token of the `windows-mcp` MCP server |

Create each file with the value as its only content:

```PowerShell
New-Item -ItemType Directory -Force "$HOME\.secrets" | Out-Null
Set-Content -NoNewline "$HOME\.secrets\windows-mcp-key" "<token>"
```

> [!IMPORTANT]
> OpenCode refuses to start while a referenced file is missing (`bad file reference: … does not exist`), so create every file in the table before the first start.

### 4. Start OpenCode

Start OpenCode in any project directory:

```PowerShell
opencode
```

On the first start, OpenCode installs the plugin runtime into `node_modules/` and writes `package.json` and the lock files; all of them are gitignored.

## Usage

### Chrome profile slots

Every OpenCode process claims the lowest free slot `N` and runs the `chrome-devtools` MCP server on the profile `~/.cache/chrome-devtools-mcp/opencode-profile-N`. Parallel instances therefore never share a browser, and a slot keeps its logins between sessions. The window title shows the slot as a `[N]` prefix, and every agent shell sees it as `$env:CHROME_SLOT`.

To prefer a specific slot, set it before starting:

```PowerShell
$env:CHROME_SLOT = '3'; opencode
```

> [!NOTE]
> The preference is honored only while the slot is free; a taken slot falls back to the lowest free one. A slot is released when its OpenCode process ends, however it ends.

The mechanics are the header comments of [`plugins/chrome-slot.js`](./plugins/chrome-slot.js) and [`tui-plugins/slot-title.js`](./tui-plugins/slot-title.js).

### llama-server models

A `llama.cpp@…` provider in `opencode.json` carries only its `baseURL`. At startup, [`plugins/llama-limits.js`](./plugins/llama-limits.js) asks each router for the models of its preset file and adds them with their context limit and input modalities. A server that does not answer within 100 ms shows no models.

> [!NOTE]
> The list is read once per start: after starting llama-server or editing a preset, restart OpenCode.

### Change the configuration

Edit the files in place and restart OpenCode. Machine-specific values go through `{env:…}` or `{file:…}` rather than into the file, so the same `opencode.json` works on every machine; paths use `C:/Users/{env:USERNAME}/…`, because the backslashes in `USERPROFILE` would break the JSON.

## License

[MIT](./LICENSE)

## Support

If a plugin or skill here saves you a hassle, consider supporting future work:

- [GitHub Sponsors](https://github.com/sponsors/countzero): recurring or one-time.
- [Ko-fi](https://ko-fi.com/finnkumkar): one-time tip, no signup required.

<a href="https://ko-fi.com/finnkumkar"><img src="https://storage.ko-fi.com/cdn/kofi2.png?v=6" alt="Support on Ko-fi" width="180"></a>
