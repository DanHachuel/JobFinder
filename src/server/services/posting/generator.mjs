/**
 * JobFinder — post generator (LLM).
 *
 * Pipeline adapted from the open-source references (Jeezlouis/
 * LinkedIn-Content-System, chussboi96/linkedin-autopost): a theme plus
 * optional instructions become a prompt; the configured LLM returns the
 * draft, which the UI always shows for approval before publishing.
 */
import { chat, isProviderConfigured } from '../llm/index.mjs';

export const LINKEDIN_POST_LIMIT = 3000;

const SYSTEM_PROMPT =
  'Voce e um redator profissional especialista em conteudo para LinkedIn. ' +
  'Escreva em portugues do Brasil, texto puro (sem markdown, sem hashtags em excesso, maximo 3 hashtags), ' +
  'tom humano e direto, primeira pessoa, com paragrafos curtos. Nunca use emojis em excesso (maximo 2).';

/** Build the user prompt for a topic. */
export function buildPrompt({ topic, instructions }) {
  const parts = [
    `Tema: ${topic.name}`,
    topic.prompt ? `Diretriz do tema: ${topic.prompt}` : null,
    instructions ? `Instrucoes adicionais do usuario: ${instructions}` : null,
    `Escreva UM post de LinkedIn sobre o tema, entre 900 e 1500 caracteres, terminando com uma pergunta que convide comentarios.`,
  ].filter(Boolean);
  return parts.join('\n');
}

/** Clean the model output (trim, collapse spacing, enforce the limit). */
export function sanitizePostText(raw, limit = LINKEDIN_POST_LIMIT) {
  let text = String(raw ?? '').trim();
  text = text.replace(/```(?:\w+)?/g, '').replace(/\*\*/g, '').replace(/^\s*#{1,6}\s*/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > limit) {
    text = `${text.slice(0, limit - 1).trimEnd()}…`;
  }
  return text;
}

/**
 * Generate a post draft for a topic.
 * @returns {Promise<{ text, provider, model, durationMs }>}
 */
export async function generatePost({ config, topic, instructions }) {
  if (!isProviderConfigured(config)) {
    const err = new Error(
      `Provedor LLM "${config?.llm?.provider}" nao configurado. Ajuste em Config > LLM (ou use "ollama" local).`
    );
    err.status = 503;
    err.code = 'service_unavailable';
    throw err;
  }
  const prompt = buildPrompt({ topic, instructions });
  const result = await chat(config, { system: SYSTEM_PROMPT, prompt });
  return {
    text: sanitizePostText(result.text),
    rawLength: result.text.length,
    provider: result.provider,
    model: result.model,
    durationMs: result.durationMs,
  };
}
