/**
 * JobFinder — LLM service.
 *
 * Providers (config.llm.provider):
 *   openai    — OpenAI-compatible chat completions (api.openai.com/v1)
 *   deepseek  — OpenAI-compatible (api.deepseek.com/v1)
 *   ollama    — LOCAL, OpenAI-compatible (localhost:11434/v1), no key
 *   anthropic — Anthropic Messages API (native format)
 *
 * Uses the global fetch (Node >= 18). API keys live only in the local
 * config.json and are never sent anywhere except the provider itself.
 */
import { badGateway, serviceUnavailable } from '../../middleware/errors.mjs';

export const PROVIDER_DEFAULTS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
};

/** True when the provider has what it needs to run. */
export function isProviderConfigured(config) {
  const llm = config?.llm ?? {};
  const provider = llm.provider ?? 'ollama';
  if (provider === 'ollama') return true; // local, no key
  return Boolean(llm.apiKey);
}

/** Normalize provider settings with defaults. */
function resolveSettings(llm = {}) {
  const provider = llm.provider ?? 'ollama';
  const defaults = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.ollama;
  return {
    provider,
    baseUrl: (llm.baseUrl || defaults.baseUrl).replace(/\/$/, ''),
    model: llm.model || defaults.model,
    apiKey: llm.apiKey || '',
    temperature: llm.temperature ?? 0.7,
    maxTokens: llm.maxTokens ?? 1024,
  };
}

/**
 * Chat completion against the configured provider.
 * @param {object} config config.json contents
 * @param {object} options { system, prompt }
 * @returns {Promise<{ text: string, provider: string, model: string, usage?: object }>}
 */
export async function chat(config, { system, prompt }) {
  if (!isProviderConfigured(config)) {
    throw serviceUnavailable(
      `Provedor LLM "${config?.llm?.provider}" sem API key. Configure em Config ($.llm.apiKey) ou use "ollama" (local, sem chave).`
    );
  }
  const settings = resolveSettings(config.llm);
  const startedAt = Date.now();

  let text;
  let usage;
  if (settings.provider === 'anthropic') {
    ({ text, usage } = await anthropicChat(settings, { system, prompt }));
  } else {
    ({ text, usage } = await openAiCompatibleChat(settings, { system, prompt }));
  }
  return { text, provider: settings.provider, model: settings.model, usage, durationMs: Date.now() - startedAt };
}

/** Wrap a fetch failure into a clear, actionable LLM error. */
async function guardedFetch(url, options, settings) {
  try {
    return await fetch(url, options);
  } catch (err) {
    const hint =
      settings.provider === 'ollama'
        ? 'Ollama nao respondeu. Inicie com "ollama serve" (ou troque o provedor em Config).'
        : `Nao foi possivel conectar ao provedor ${settings.provider} em ${settings.baseUrl}. Verifique a URL e a rede.`;
    throw badGateway(`LLM ${settings.provider} indisponivel`, { message: err.message, hint });
  }
}

async function openAiCompatibleChat(settings, { system, prompt }) {
  const url = `${settings.baseUrl}/chat/completions`;
  const res = await guardedFetch(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt },
        ],
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
      }),
    },
    settings
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw badGateway(`LLM ${settings.provider}`, {
      status: res.status,
      message: data?.error?.message ?? data?.message ?? res.statusText,
    });
  }
  const text = data?.choices?.[0]?.message?.content ?? '';
  return { text, usage: data?.usage ?? null };
}

async function anthropicChat(settings, { system, prompt }) {
  const url = `${settings.baseUrl}/messages`;
  const response = await guardedFetch(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: settings.maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
        temperature: settings.temperature,
      }),
    },
    settings
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw badGateway('LLM anthropic', {
      status: response.status,
      message: data?.error?.message ?? response.statusText,
    });
  }
  const text = (data?.content ?? [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return { text, usage: data?.usage ?? null };
}
