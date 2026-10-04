// Guards OpenCode's experimental background subagents (the task tool's background=true).
// They run unwatched: a looping one burns tokens until someone notices
// (https://github.com/anomalyco/opencode/issues/45442), and v1 stops them only all at once,
// with Esc on the parent. This refuses background tasks for any agent but explore, caps the
// running ones per parent session, and adds usage rules to the task tool's description.
//
// Inert unless OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS is on. OpenCode reads that flag
// at startup, before any plugin runs, so a plugin cannot turn it on itself.
//
// Install: drop this file into a plugins/ directory under an OpenCode config root and
// restart. ~/.config/opencode/plugins/ makes it global, a checkout's .opencode/plugins/
// scopes it to that project.

// Per parent session, not per process: switching sessions in the TUI leaves the jobs of the
// one left behind running, so two busy sessions can hold twice this many.
const maxRunning = 20;

const allowedAgents = new Set([
    'explore',
]);

// A call whose tool.execute.after never fires (its execute threw) would hold a slot forever.
const pendingTtlMs = 60_000;

// Plugin events are filtered by directory, so a session moved into a worktree never reports
// its children idle, and a child can go idle before its receipt is recorded. Either way the
// slot would never free.
const runningTtlMs = 60 * 60_000;

const rules = [
    'Background guard (local plugin):',
    '- background=true only with subagent_type explore, for read-only research. Never for edits or the browser: this process has one Chrome profile, and parallel browser work collides on it.',
    '- Start background tasks only when the user asked for them or approved your proposal.',
    '- When launching, tell the user in one line what started, and track each task as a todo item.',
    '- A result that arrives while others you launched together still run gets a one-line acknowledgment at most. After the last one, give one combined report: the result, then the single next step.',
].join('\n');

// Mirrors OpenCode's own reading of the flag (Effect's Config.boolean, case-sensitive): the
// specific variable wins, else the umbrella OPENCODE_EXPERIMENTAL.
const truthy = value => [
    'true',
    'yes',
    'on',
    '1',
    'y',
].includes(value);

const enabled = () => {
    const own = process.env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS;

    return own === undefined ? truthy(process.env.OPENCODE_EXPERIMENTAL) : truthy(own);
};

export const BackgroundGuard = async () => {
    if (!enabled()) {
        return {};
    }

    // Slot key to { parent, until }. Keyed by the call ID while the call is let through but
    // its receipt not yet seen, so several background calls in one message cannot all pass
    // the same check; then by the child's session ID, which the receipt names.
    const slots = new Map();

    const occupied = parent => {
        const now = Date.now();
        let count = 0;

        for (const [key, slot] of slots) {
            if (slot.until < now) {
                slots.delete(key);
            } else if (slot.parent === parent) {
                count += 1;
            }
        }

        return count;
    };

    return {
        'tool.definition': async (input, output) => {
            if (input.toolID === 'task') {
                output.description = `${output.description}\n\n${rules}`;
            }
        },

        'tool.execute.before': async (input, output) => {
            if (input.tool !== 'task' || output.args?.background !== true) {
                return;
            }

            const agent = output.args.subagent_type;

            if (!allowedAgents.has(agent)) {
                throw new Error(`background-guard: background tasks are limited to ${[...allowedAgents].join(', ')}; run this ${agent} task in the foreground (omit background).`);
            }

            if (occupied(input.sessionID) >= maxRunning) {
                throw new Error(`background-guard: ${maxRunning} background tasks are already running in this session; wait for one to finish, or run this task in the foreground (omit background).`);
            }

            slots.set(input.callID, {
                parent: input.sessionID,
                until: Date.now() + pendingTtlMs,
            });
        },

        // Also sees a foreground task moved to the background with Ctrl+B: its receipt
        // carries background=true as well, so it counts against the cap from then on.
        'tool.execute.after': async (input, output) => {
            if (input.tool !== 'task') {
                return;
            }

            slots.delete(input.callID);

            const child = output.metadata?.sessionId ?? output.metadata?.sessionID;

            if (output.metadata?.background !== true || child === undefined) {
                return;
            }

            slots.set(child, {
                parent: input.sessionID,
                until: Date.now() + runningTtlMs,
            });
        },

        // A child goes idle on completion, failure and cancellation alike.
        event: async ({ event }) => {
            if (event.type === 'session.idle') {
                slots.delete(event.properties?.sessionID);
            }
        },
    };
};
