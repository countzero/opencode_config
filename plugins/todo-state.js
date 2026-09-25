// Re-states a session's todo list on every step. Both OpenCode and Claude Code leave the
// list where the last todowrite put it, which drifts arbitrarily far back in a long turn;
// this puts it back in view. Delete once upstream lands a fix:
//
//   https://github.com/anomalyco/opencode/issues/41359  (list goes stale mid-task)
//   https://github.com/anomalyco/opencode/issues/27560  (items never marked completed)
//   https://github.com/anomalyco/opencode/pull/48729    (the proposed fix)
//
// Last in the array, after the newest tool result, because a prompt cache keys on an exact
// prefix: there a todo change re-writes only the reminder, whereas on the last user message
// it re-writes every tool call of the turn behind it. A user message rather than a part on
// the assistant message, which would read back as the model's own words. Nothing is
// persisted either way: messages are re-read fresh from the database each step, so the
// reminder reaches the model and is gone.
//
// Install: drop this file into a plugins/ directory under an OpenCode config root and
// restart. Server plugins are found there by a {plugin,plugins}/*.{ts,js} glob, so nothing
// has to name the file in opencode.json. ~/.config/opencode/plugins/ makes it global,
// a checkout's .opencode/plugins/ scopes it to that project.

const openStatuses = new Set([
    'pending',
    'in_progress',
]);

const render = todos => {
    const open = todos.filter(todo => openStatuses.has(todo.status));

    if (open.length === 0) {
        return undefined;
    }

    // Anthropic models are conditioned to read this wrapper as out-of-band instruction.
    // Stated, not asked: a conditional request ("if this no longer matches, call todowrite")
    // gets answered in the reply, step after step ("the todo list still matches").
    return [
        '<system-reminder>',
        'Your stored todo list:',
        ...open.map(todo => `${todo.status}: ${todo.content}`),
        'Bookkeeping only: update it with todowrite as items finish.',
        'Your reply is to the user and does not mention this reminder or whether the list matches.',
        '</system-reminder>',
    ].join('\n');
};

// Cloned off a real user message rather than built from scratch, so the request pipeline
// finds every field it reads without this file tracking the Message and Part types.
const textPart = (source, messageID, text) => {
    const template = source.parts.find(part => part.type === 'text');

    return {
        ...template,
        id: `${messageID}_part`,
        messageID,
        type: 'text',
        text,
    };
};

const reminder = (source, text) => {
    const id = `${source.info.id}_todo_state`;

    return {
        info: {
            ...source.info,
            id,
        },
        parts: [
            textPart(source, id, text),
        ],
    };
};

export const TodoState = async ({ client }) => ({
    'experimental.chat.messages.transform': async (_input, output) => {
        try {
            const target = output.messages?.findLast(message => message.info.role === 'user');

            if (target === undefined) {
                return;
            }

            // Read per step rather than cached from `todo.updated`: plugin event delivery is
            // filtered by directory, so a session moved into a worktree starves such a cache.
            const response = await client.session.todo({
                path: {
                    id: target.info.sessionID,
                },
            });
            const text = render(Array.isArray(response.data) ? response.data : []);

            if (text === undefined) {
                return;
            }

            const last = output.messages.at(-1);

            // On a turn's first step the user message is already last, so a part on it
            // lands in the same place without risking two user messages in a row.
            if (last === target) {
                target.parts.push(textPart(target, target.info.id, text));

                return;
            }

            output.messages.push(reminder(target, text));
        } catch (error) {
            client.app?.log?.({
                body: {
                    service: 'todo-state',
                    level: 'warn',
                    message: 'could not inject the todo state',
                    extra: {
                        error: error?.message ?? String(error),
                    },
                },
            }).catch(() => undefined);
        }
    },
});
