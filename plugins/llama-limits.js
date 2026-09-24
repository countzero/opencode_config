// Fills every llama-server provider in the config with the models of the server's presets,
// each with the context one request gets and its input modalities, so opencode.json carries
// only the baseURL and a preset change needs no config edit.
//
// The config hook runs before OpenCode reads cfg.provider, which makes it the one place to
// add models: the plugin `provider.models` hook only reaches providers in the models.dev
// catalog. The list is read once per start, so a server started later, or a preset edited,
// shows after a restart.
//
// A loaded model reports its slot context (`meta.n_ctx`). For the others the context is
// derived from the preset the way llama-server sizes it (server.cpp, llama-context.cpp,
// n_ctx_slot()): ctx-size padded to 256, divided by parallel unless the KV cache is unified,
// capped by kv-unified-per-slot and by a context_length override. A preset without ctx-size
// uses the training context, which only a loaded model reports; until then the model keeps
// whatever limit the config gives it.
//
// Only router entries from a preset file are listed (`source: "preset"`): --models-dir adds
// every GGUF in the directory, most of them without a tuned preset.
//
// Install: drop this file into ~/.config/opencode/plugins/ and restart. The loader calls
// every export as a plugin, so this module exports nothing else.

import { lookup } from 'node:dns/promises';

/** Bounds the startup delay an unreachable host causes; a reachable router on the LAN answers in ms. */
const timeoutMs = 250;

/** llama-server reports no output limit, and OpenCode budgets a reply by one. */
const outputCeiling = 65536;

const kvPadding = 256;

/** `--parallel -1`, llama-server's default, means four slots on a unified KV cache. */
const autoParallel = 4;

const pad = tokens => Math.ceil(tokens / kvPadding) * kvPadding;

const truthy = value => ['on', 'enabled', 'true', '1'].includes(String(value).trim().toLowerCase());

const parsePreset = ini => Object.fromEntries((ini ?? '')
    .split('\n')
    .map(line => line.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value]));

const presetContext = preset => {
    const perSlot = Number(preset['kv-unified-per-slot'] ?? 0);
    const auto = Number(preset.parallel ?? -1) < 0;
    const parallel = auto ? autoParallel : Number(preset.parallel);
    const unified = auto || truthy(preset['kv-unified'] ?? 'false');
    const configured = Number(preset['ctx-size'] ?? 0);
    const size = preset['ctx-size'] === undefined && perSlot > 0 ? parallel * perSlot : configured;

    if (!size) {
        return undefined;
    }

    const pool = pad(size);
    const slot = Math.min(unified ? pool : pad(Math.floor(pool / parallel)), perSlot || Infinity);
    const trained = preset['override-kv']?.match(/(?:^|,)\s*[\w.-]+\.context_length=int:(\d+)/);

    return trained ? Math.min(slot, Number(trained[1])) : slot;
};

const toModel = (entry, configured = {}) => {
    const context = entry.meta?.n_ctx || presetContext(parsePreset(entry.status?.preset));

    return {
        ...configured,
        name: configured.name ?? entry.id,
        modalities: { input: entry.architecture?.input_modalities ?? ['text'], output: ['text'] },
        ...(context ? { limit: { context, output: Math.min(outputCeiling, context) } } : {}),
    };
};

// A LAN name resolves to its IPv6 addresses first, llama-server listens on 0.0.0.0 by
// default, and Bun tries the IPv6 addresses before IPv4: 6 s against a server on this
// machine, far past timeoutMs.
const modelsURL = async baseURL => {
    const url = new URL(`${baseURL.replace(/\/+$/, '')}/models`);

    url.hostname = (await lookup(url.hostname, { family: 4 })).address;

    return url;
};

const fetchModels = async ({ baseURL, apiKey }) => {
    const response = await fetch(await modelsURL(baseURL), {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()).data ?? [];
};

// Not awaited: the log endpoint belongs to the instance this config hook is still building.
const warn = (client, message) => {
    Promise.resolve()
        .then(() => client.app.log({ body: { service: 'llama-limits', level: 'warn', message } }))
        .catch(() => {});
};

export const LlamaLimits = async ({ client }) => ({
    config: async config => {
        const servers = Object.entries(config.provider ?? {})
            .filter(([, provider]) => provider.npm === '@ai-sdk/openai-compatible' && provider.options?.baseURL);

        await Promise.all(servers.map(async ([id, provider]) => {
            let entries;

            try {
                entries = await fetchModels(provider.options);
            } catch (error) {
                warn(client, `${id}: ${provider.options.baseURL} not reachable (${error.message})`);

                return;
            }

            const presets = entries.filter(entry => entry.owned_by === 'llamacpp' && entry.source === 'preset');

            if (presets.length) {
                provider.models ??= {};

                for (const entry of presets) {
                    provider.models[entry.id] = toModel(entry, provider.models[entry.id]);
                }
            }
        }));
    },
});
