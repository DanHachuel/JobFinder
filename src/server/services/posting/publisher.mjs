/**
 * JobFinder — post publisher.
 *
 * Publishes through the unified LinkedIn facade (official API when a
 * channel with OAuth is active, cookie fallback otherwise). Records the
 * result in posts.json: published | failed, with the LinkedIn post id and
 * the simulation flag for dry-run.
 */
import { sanitizePostText, LINKEDIN_POST_LIMIT } from './generator.mjs';
import { requireLiveLinkedInClient } from '../linkedin/index.mjs';

/** Validate a draft before publishing. Throws HttpError on problems. */
export function assertPublishable(post) {
  if (!post) {
    const err = new Error('Post nao encontrado');
    err.status = 404;
    throw err;
  }
  if (!['draft', 'scheduled', 'failed'].includes(post.status)) {
    const err = new Error(`Post nao pode ser publicado no status "${post.status}"`);
    err.status = 409;
    throw err;
  }
  const text = sanitizePostText(post.text);
  if (!text) {
    const err = new Error('Texto vazio');
    err.status = 400;
    throw err;
  }
  if (text.length > LINKEDIN_POST_LIMIT) {
    const err = new Error(`Texto excede o limite de ${LINKEDIN_POST_LIMIT} caracteres do LinkedIn`);
    err.status = 400;
    throw err;
  }
  return text;
}

/**
 * Publish a post now (manual action or scheduler tick).
 * @returns {Promise<{ post, result }>} the updated record and the LinkedIn result
 */
export async function publishPost(ctx, postId) {
  const { store, logger, config, rateLimiter } = ctx;
  const post = store.find('posts.json', postId);
  const text = assertPublishable(post);

  await store.patch('posts.json', postId, { status: 'publishing', error: null, updatedAt: new Date().toISOString() });

  let mode = 'dry-run';
  try {
    // Publishing is a real action: with dry-run OFF a channel is mandatory.
    const live = requireLiveLinkedInClient({ store, logger, config, rateLimiter });
    mode = live.mode;
    const result = await live.client.createPost({ text });
    const updated = await store.patch('posts.json', postId, {
      status: 'published',
      publishedAt: new Date().toISOString(),
      linkedinPostId: result?.id ?? result?.value?.entityUrn ?? null,
      simulated: Boolean(result?.simulated),
      authMode: mode,
      error: null,
    });
    logger.info('posting', `post published (${mode}${result?.simulated ? ' dry-run' : ''})`, { postId, chars: text.length });
    return { post: updated, result };
  } catch (err) {
    const updated = await store.patch('posts.json', postId, {
      status: 'failed',
      error: err.message,
      authMode: mode,
    });
    logger.error('posting', 'post failed', { postId, message: err.message });
    return { post: updated, error: err };
  }
}
