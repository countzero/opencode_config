// Gives every OpenCode process its own chrome-devtools-mcp profile, the lowest slot no other
// running process holds, so parallel instances started as plain `opencode` never share one.
// A CHROME_SLOT in the environment is only a preference, claimed like any other slot and
// passed over when taken: a taken profile could not start Chrome anyway, and an OpenCode
// started from an agent shell inherits its parent's CHROME_SLOT, so it needs one of its own.
//
// The config hook writes the slot into the MCP's --userDataDir: plugins run after {env:...}
// is resolved but before any MCP server starts, and the hook edits the very config object
// the MCP service reads.
//
// Listening is the claim: on a named pipe on Windows, elsewhere on a localhost TCP port,
// because a Unix socket file would outlive a crash. The OS frees either when its process
// ends, however it ends, so a crashed instance never strands its slot. Bun reports a taken
// pipe as ERR_INVALID_ARG_TYPE rather than EADDRINUSE, and a port another program holds is
// as unusable as one another instance holds, so any listen error counts as taken.
//
// One slot per process, not per directory, so parallel sessions share one logged-in profile.
// The cost: after worktree_enter, the worktree's MCP cannot launch Chrome while the main
// tree's still runs on that profile.
//
// Install: drop this file into ~/.config/opencode/plugins/ and restart. The loader calls
// every export as a plugin, so this module exports nothing else.

import net from 'node:net';

/** Bounds the scan and keeps basePort + slot a valid port; no machine runs this many instances. */
const slotCeiling = 1000;

const basePort = 47300;

/** Registry-global, so a config reload or a second directory reuses the claim. */
const claimKey = Symbol.for('local.chrome-slot');

const listen = slot => new Promise(resolve => {
    const server = net.createServer().once('error', () => resolve(false));
    const claimed = () => resolve(true);

    if (process.platform === 'win32') {
        server.listen(`\\\\.\\pipe\\opencode-chrome-slot-${slot}`, claimed);
    } else {
        server.listen(basePort + Number(slot), '127.0.0.1', claimed);
    }
});

const claim = async preferred => {
    if (/^\d+$/.test(preferred ?? '') && Number(preferred) < slotCeiling && await listen(preferred)) {
        return preferred;
    }

    for (let slot = 0; slot < slotCeiling; slot++) {
        if (await listen(slot)) {
            return String(slot);
        }
    }

    return undefined;
};

export const ChromeSlot = async () => ({
    config: async config => {
        const server = config.mcp?.['chrome-devtools'];

        if (!server?.command) {
            return;
        }

        const slot = await (globalThis[claimKey] ??= claim(process.env.CHROME_SLOT?.trim()));

        if (!slot) {
            // A profile nobody claimed would collide silently; a disabled MCP shows in /mcp.
            server.enabled = false;

            return;
        }

        server.command = server.command.map(argument => argument.replace(/(opencode-profile-)[^\\/]*$/, `$1${slot}`));
    },
    'shell.env': async (_input, output) => {
        const slot = await globalThis[claimKey];

        if (slot) {
            output.env.CHROME_SLOT = slot;
        }
    },
});
