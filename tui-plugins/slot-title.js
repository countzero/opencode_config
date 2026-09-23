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

const tui = async api => {
    const { renderer } = api;

    if (renderer.setTerminalTitle[marker]) {
        return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(renderer, 'setTerminalTitle');
    const original = renderer.setTerminalTitle.bind(renderer);

    let requestedTitle = '';

    const wrapper = title => {
        requestedTitle = title;

        const slot = slotOf(api.state.config);

        // An empty title is how upstream clears it, on shutdown and from the
        // "terminal.title.toggle" command; prefixing would strand the slot on the tab.
        original(title && slot ? `[${slot}] ${title}` : title);
    };

    wrapper[marker] = true;

    // TuiPluginApi offers no title hook, so the renderer's own method is the only seam.
    renderer.setTerminalTitle = wrapper;
    wrapper(homeTitle);

    // Also where the prefix first appears: the config syncs in after this plugin loads.
    const unsubscribe = api.event.on(turnBoundary, () => wrapper(requestedTitle));

    api.lifecycle.onDispose(() => {
        unsubscribe();

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
