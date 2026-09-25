// Prefixes the terminal title with this worker's slot, so several OpenCode windows sharing
// one taskbar can be told apart. The slot is the chrome-devtools MCP profile number that
// plugins/chrome-slot.js claims. It is read from the server's resolved config: the server
// runs in a Worker holding its own copy of the environment, so a slot it claims never
// reaches this thread's process.env.
//
// Install: name this file in the tui.json of an OpenCode config root, then restart:
//
//   { "plugin": ["./tui-plugins/slot-title.js"] }
//
// The path resolves against the tui.json that declares it, and that entry is the only thing
// that loads a TUI plugin; there is no directory auto-discovery on this side. Keep the file
// out of a directory named plugin or plugins, though: the server globs
// {plugin,plugins}/*.{ts,js} in every config root and rejects what it finds there for
// exporting tui() rather than server(). The TUI loads it from tui.json regardless, so the
// cost is one error line per session start.
//
// On Windows a copy or an image paste also knocks the title off the tab. OpenCode runs both
// through powershell.exe on the console it runs in, and Windows PowerShell 5.1 renames that
// console as it starts, which the terminal shows until the title is written again (upstream
// #32293; 1.x will not fix it). OpenCode bound child_process.spawn at import, but Bun's
// child_process.spawn looks up Bun.spawn on every call, so wrapping Bun.spawn sees each
// PowerShell start. While one runs, a poll on the console title writes the title back
// whenever it changes. Drop watchPowerShell once OpenCode stops calling PowerShell.

const id = 'local.slot-title';

/** Registry-global, so the guard survives a reload re-evaluating this module; a module-local WeakSet would not. */
const marker = Symbol.for(id);

/** What upstream puts on the home route, and so the honest placeholder until it names a session. */
const homeTitle = 'OpenCode';

/**
 * Fires at both ends of a turn, which repairs a title promptly without writing one per token.
 * Upstream writes a title only when the route or the session title changes, never to repair
 * one that other output has overwritten.
 */
const turnBoundary = 'session.status';

/** Windows PowerShell 5.1, the one that renames the console; OpenCode never starts pwsh. */
const powerShell = /(?:^|[\\/])powershell(?:\.exe)?$/i;

const pollMilliseconds = 100;

/** Longer than any title this plugin writes; GetConsoleTitleW truncates past it. */
const titleCapacity = 1024;

/**
 * Uncovers the method the patch hid.
 *
 * `setTerminalTitle` is `CliRenderer.prototype`'s, so patching it added an own property;
 * deleting that property restores the prototype lookup, where assigning the bound original
 * back would leave a bound copy shadowing it forever. A descriptor is only present when
 * another plugin patched first, and then it holds that plugin's wrapper rather than the
 * prototype method.
 */
const restore = (renderer, descriptor) => {
    if (descriptor) {
        Object.defineProperty(renderer, 'setTerminalTitle', descriptor);

        return;
    }

    delete renderer.setTerminalTitle;
};

/**
 * Reads the slot chrome-slot.js wrote into the MCP's --userDataDir.
 * @param config - The server config as the TUI synced it; empty until the first sync.
 * @returns The slot, or undefined before the sync or without a slotted profile.
 */
const slotOf = config => config.mcp?.['chrome-devtools']?.command
    ?.map(argument => /opencode-profile-(\d+)$/.exec(argument)?.[1])
    .find(Boolean);

/**
 * Reads the console title, which Bun's process.title cannot: its getter returns the last
 * value set through it, not what another process on the console wrote since.
 * @returns The reader, or undefined off Windows or when kernel32 does not load.
 */
const consoleTitleReader = async () => {
    if (process.platform !== 'win32') {
        return undefined;
    }

    try {
        const { dlopen, FFIType } = await import('bun:ffi');
        const { symbols } = dlopen('kernel32.dll', {
            GetConsoleTitleW: {
                args: [FFIType.ptr, FFIType.u32],
                returns: FFIType.u32,
            },
        });
        const buffer = new Uint16Array(titleCapacity);
        const decoder = new TextDecoder('utf-16le');

        return () => {
            const length = symbols.GetConsoleTitleW(buffer, titleCapacity);

            return decoder.decode(buffer.subarray(0, length));
        };
    } catch (error) {
        console.error(`${id}: no console title, so copy and paste still reset the title`, error);

        return undefined;
    }
};

/**
 * Writes the title back while a PowerShell runs on the console; the header says why.
 * @param readConsoleTitle - Reads the title the console holds now.
 * @param expected - Returns the title last written, empty while the title is off.
 * @param repair - Writes that title again.
 * @returns What removes the wrap.
 */
const watchPowerShell = (readConsoleTitle, expected, repair) => {
    const original = Bun.spawn;

    let running = 0;
    let interval;
    let disposed = false;

    // Past the first repair too: an elevated PowerShell renames the console twice.
    const check = () => {
        if (expected() && readConsoleTitle() !== expected()) {
            repair();
        }
    };

    // Checks once more, since a rename just before the exit outlives the poll.
    const exited = () => {
        running -= 1;

        if (disposed) {
            return;
        }

        check();

        if (running === 0) {
            clearInterval(interval);
            interval = undefined;
        }
    };

    // Bun.spawn(cmd, options) and Bun.spawn({ cmd, ...options }) both reach here.
    const wrapper = function (...args) {
        const subprocess = original.apply(this, args);
        const command = Array.isArray(args[0]) ? args[0] : args[0]?.cmd;

        if (!disposed && powerShell.test(command?.[0] ?? '')) {
            running += 1;
            interval ??= setInterval(check, pollMilliseconds);
            subprocess.exited.then(exited, exited);
        }

        return subprocess;
    };

    // Writable but not configurable, so assignment is the only way on and off.
    Bun.spawn = wrapper;

    return () => {
        disposed = true;
        clearInterval(interval);

        // Whoever wrapped over this one owns the property now.
        if (Bun.spawn === wrapper) {
            Bun.spawn = original;
        }
    };
};

const tui = async api => {
    const { renderer } = api;

    if (renderer.setTerminalTitle[marker]) {
        return;
    }

    const readConsoleTitle = await consoleTitleReader();
    const descriptor = Object.getOwnPropertyDescriptor(renderer, 'setTerminalTitle');
    const original = renderer.setTerminalTitle.bind(renderer);
    const shellTitle = readConsoleTitle?.();

    let requestedTitle = '';
    let writtenTitle = '';

    const wrapper = title => {
        requestedTitle = title;

        const slot = slotOf(api.state.config);

        // An empty title is how upstream clears it, on shutdown and from the
        // "terminal.title.toggle" command; prefixing would strand the slot on the tab.
        writtenTitle = title && slot ? `[${slot}] ${title}` : title;
        original(writtenTitle);

        // The console keeps a title of its own, the one PowerShell overwrites and the watch
        // compares; an empty title hands back the shell's.
        if (readConsoleTitle) {
            process.title = writtenTitle || shellTitle;
        }
    };

    wrapper[marker] = true;

    // TuiPluginApi offers no title hook, so the renderer's own method is the only seam.
    renderer.setTerminalTitle = wrapper;
    wrapper(homeTitle);

    // Also where the prefix first appears: the config syncs in after this plugin loads.
    const unsubscribe = api.event.on(turnBoundary, () => wrapper(requestedTitle));

    const unwatch = readConsoleTitle
        ? watchPowerShell(readConsoleTitle, () => writtenTitle, () => wrapper(requestedTitle))
        : () => {};

    api.lifecycle.onDispose(() => {
        unsubscribe();
        unwatch();

        // Whoever wrapped over this one owns the property now.
        if (renderer.setTerminalTitle === wrapper) {
            restore(renderer, descriptor);
        }
    });
};

export default {
    id,
    tui,
};
