# OpenCode Configuration

Personal global configuration for [OpenCode](https://opencode.ai) on Windows. The repository is the `~/.config/opencode` directory itself, so OpenCode reads it in place and every machine that clones it gets:

1. The global `opencode.json` with models, agents, permissions, MCP servers and providers
2. The TUI settings in `tui.json`
3. Plugins that give every OpenCode instance its own Chrome profile slot
4. Global rules in `AGENTS.md` and the skills they list

## Installation

### 1. Install Prerequisites

Download and install the latest versions:

* [Git](https://git-scm.com/download)
* [Node.js LTS](https://nodejs.org/en/download), whose `npx` starts the `chrome-devtools` MCP server
* [OpenCode](https://opencode.ai/docs/#install)
* [Chromium](https://www.chromium.org/getting-involved/download-chromium/), installed per user to `C:\Users\<name>\AppData\Local\Chromium`

### 2. Clone the repository from GitHub

Move an existing configuration aside, then clone the repository into its place:

```PowerShell
Rename-Item "$HOME\.config\opencode" "opencode.backup" -ErrorAction SilentlyContinue
git clone git@github.com:countzero/opencode_config.git "$HOME\.config\opencode"
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

### Change the configuration

Edit the files in place and restart OpenCode. Machine-specific values go through `{env:…}` or `{file:…}` rather than into the file, so the same `opencode.json` works on every machine; paths use `C:/Users/{env:USERNAME}/…`, because the backslashes in `USERPROFILE` would break the JSON.
