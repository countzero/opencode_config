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
// On Windows a copy also knocks the title off the tab. OpenCode copies by starting
// powershell.exe on the console it runs in, and Windows PowerShell 5.1 renames that console
// as it starts, which the terminal shows until the title is written again (upstream #32293;
// 1.x will not fix it). The spawn is out of reach: OpenCode bound child_process.spawn at
// import, so replacing it changes nothing. Every copy clears the selection right after
// starting its clipboard write, though, so a clear with text selected opens a watch of a
// few seconds on the console title that writes the title back whenever it changes. Drop
// watchCopies once OpenCode copies without PowerShell.

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

/** Long enough for a cold Windows PowerShell to start and exit; each copy restarts it. */
const watchMilliseconds = 3000;

const pollMilliseconds = 100;

/** Longer than any title this plugin writes; GetConsoleTitleW truncates past it. */
const titleCapacity = 1024;

/**
 * Uncovers the renderer method a patch hid.
 *
 * Both patched methods are `CliRenderer.prototype`'s, so patching one added an own property;
 * deleting that property restores the prototype lookup, where assigning the bound original
 * back would leave a bound copy shadowing it forever. A descriptor is only present when
 * another plugin patched first, and then it holds that plugin's wrapper rather than the
 * prototype method.
 */
const restore = (renderer, name, descriptor) => {
    if (descriptor) {
        Object.defineProperty(renderer, name, descriptor);

        return;
    }

    delete renderer[name];
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
        console.error(`${id}: no console title, so a copy still resets the title`, error);

        return undefined;
    }
};

/**
 * Writes the title back while a copy's PowerShell renames the console; the header says why.
 * @param renderer - The renderer, whose clearSelection every copy calls.
 * @param readConsoleTitle - Reads the title the console holds now.
 * @param expected - Returns the title last written, empty while the title is off.
 * @param repair - Writes that title again.
 * @returns What removes the patch.
 */
const watchCopies = (renderer, readConsoleTitle, expected, repair) => {
    const descriptor = Object.getOwnPropertyDescriptor(renderer, 'clearSelection');
    const original = renderer.clearSelection.bind(renderer);

    let deadline = 0;
    let interval;

    const check = () => {
        if (Date.now() > deadline) {
            clearInterval(interval);
            interval = undefined;

            return;
        }

        // Past the first repair too: an elevated PowerShell renames the console twice.
        if (expected() && readConsoleTitle() !== expected()) {
            repair();
        }
    };

    const wrapper = (...args) => {
        // A click away from a selection clears it too; its watch finds nothing.
        if (expected() && renderer.getSelection()?.getSelectedText()) {
            deadline = Date.now() + watchMilliseconds;
            interval ??= setInterval(check, pollMilliseconds);
        }

        return original(...args);
    };

    renderer.clearSelection = wrapper;

    return () => {
        clearInterval(interval);

        if (renderer.clearSelection === wrapper) {
            restore(renderer, 'clearSelection', descriptor);
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

        // The console keeps a title of its own, the one a copy's PowerShell overwrites and
        // the watch compares; an empty title hands back the shell's.
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
        ? watchCopies(renderer, readConsoleTitle, () => writtenTitle, () => wrapper(requestedTitle))
        : () => {};

    api.lifecycle.onDispose(() => {
        unsubscribe();
        unwatch();

        // Whoever wrapped over this one owns the property now.
        if (renderer.setTerminalTitle === wrapper) {
            restore(renderer, 'setTerminalTitle', descriptor);
        }
    });
};

export default {
    id,
    tui,
};
