/**
 * JobFinder — posts routes (§5.1).
 *
 *   GET    /api/posts                     history (filters: status, topicId, from, to, page)
 *   POST   /api/posts                     manual draft { text, scheduledAt? }
 *   POST   /api/posts/generate            LLM draft from a topic { topicId, instructions?, publishNow?, scheduledAt? }
 *   PUT    /api/posts/:id                 edit a draft/scheduled post (text, scheduledAt)
 *   POST   /api/posts/:id/publish         publish now
 *   POST   /api/posts/:id/schedule        reschedule { scheduledAt }
 *   POST   /api/posts/:id/cancel          cancel a scheduled post
 *   DELETE /api/posts/:id                 delete
 *   GET    /api/posts/stats               dashboard counters
 */
import { Router } from 'express';

import { asyncRoute, badRequest, notFound } from '../middleware/errors.mjs';
import { generatePost } from '../services/posting/generator.mjs';
import { publishPost } from '../services/posting/publisher.mjs';
import { tick as schedulerTick } from '../services/posting/scheduler.mjs';

export function postsRoutes({ store, logger, config, rateLimiter }) {
  const router = Router();
  const ctx = { store, logger, config, rateLimiter };

  router.get(
    '/posts',
    asyncRoute((req, res) => {
      const { status, topicId, from, to } = req.query;
      const where = (post) => {
        if (status && post.status !== status) return false;
        if (topicId && post.topicId !== topicId) return false;
        if (from && new Date(post.createdAt ?? 0) < new Date(String(from))) return false;
        if (to && new Date(post.createdAt ?? 0) > new Date(String(to))) return false;
        return true;
      };
      const page = store.query('posts.json', {
        where,
        sort: req.query.sort === 'scheduledAt' ? 'scheduledAt' : 'createdAt',
        order: 'desc',
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
      });
      res.json(page);
    })
  );

  router.get(
    '/posts/stats',
    asyncRoute((req, res) => {
      const posts = store.list('posts.json');
      const byStatus = {};
      for (const post of posts) byStatus[post.status] = (byStatus[post.status] ?? 0) + 1;

      const last7 = new Map();
      for (let i = 6; i >= 0; i -= 1) {
        const day = new Date();
        day.setUTCDate(day.getUTCDate() - i);
        last7.set(day.toISOString().slice(0, 10), 0);
      }
      for (const post of posts) {
        const day = (post.publishedAt ?? '').slice(0, 10);
        if (last7.has(day)) last7.set(day, (last7.get(day) ?? 0) + 1);
      }

      const upcoming = posts
        .filter((p) => p.status === 'scheduled')
        .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
        .slice(0, 5);

      res.json({
        total: posts.length,
        byStatus,
        publishedLast7Days: [...last7.entries()].map(([day, count]) => ({ day, count })),
        upcoming,
      });
    })
  );

  router.post(
    '/posts',
    asyncRoute(async (req, res) => {
      const { text, scheduledAt, topicId } = req.body ?? {};
      if (!text || !String(text).trim()) throw badRequest('text is required');
      if (String(text).length > 3000) throw badRequest('text exceeds the LinkedIn limit of 3000 characters');

      let status = 'draft';
      let scheduled = null;
      if (scheduledAt) {
        const when = new Date(scheduledAt);
        if (Number.isNaN(when.getTime())) throw badRequest('scheduledAt must be an ISO date');
        if (when.getTime() <= Date.now()) throw badRequest('scheduledAt must be in the future');
        status = 'scheduled';
        scheduled = when.toISOString();
      }

      const topic = topicId ? store.find('topics.json', topicId) : null;
      const post = await store.create(
        'posts.json',
        {
          type: 'manual',
          topicId: topic?.id ?? null,
          topicName: topic?.name ?? null,
          text: String(text),
          status: scheduled ? 'scheduled' : status,
          scheduledAt: scheduled,
        },
        'post'
      );
      logger.info('posts', 'manual post created', { id: post.id, status: post.status });
      res.status(201).json({ post });
    })
  );

  router.post(
    '/posts/generate',
    asyncRoute(async (req, res) => {
      const { topicId, instructions, publishNow, scheduledAt } = req.body ?? {};
      const topic = store.find('topics.json', topicId ?? '');
      if (!topic) throw badRequest('topicId is required and must exist');

      const generated = await generatePost({ config, topic, instructions });

      let status = 'draft';
      let scheduled = null;
      if (scheduledAt) {
        const when = new Date(scheduledAt);
        if (Number.isNaN(when.getTime())) throw badRequest('scheduledAt must be an ISO date');
        if (when.getTime() <= Date.now()) throw badRequest('scheduledAt must be in the future');
        scheduled = when.toISOString();
        status = 'scheduled';
      }

      const post = await store.create(
        'posts.json',
        {
          type: 'auto',
          topicId: topic.id,
          topicName: topic.name,
          text: generated.text,
          status,
          scheduledAt: scheduled,
          generatedBy: { provider: generated.provider, model: generated.model, durationMs: generated.durationMs },
        },
        'post'
      );
      logger.info('posts', 'post generated by LLM', { id: post.id, topicId: topic.id, provider: generated.provider });

      if (publishNow) {
        const outcome = await publishPost(ctx, post.id);
        return res.status(201).json({ post: outcome.post ?? post, generated: withoutText(generated), publish: { error: outcome.error?.message ?? null } });
      }
      res.status(201).json({ post, generated: withoutText(generated) });
    })
  );

  router.put(
    '/posts/:id',
    asyncRoute(async (req, res) => {
      const post = store.find('posts.json', req.params.id);
      if (!post) throw notFound('Post');
      if (!['draft', 'scheduled'].includes(post.status)) {
        throw badRequest(`Only drafts and scheduled posts can be edited (status "${post.status}")`);
      }
      const patch = {};
      if (req.body?.text !== undefined) {
        if (!String(req.body.text).trim()) throw badRequest('text cannot be empty');
        if (String(req.body.text).length > 3000) throw badRequest('text exceeds the LinkedIn limit of 3000 characters');
        patch.text = String(req.body.text);
      }
      if (req.body?.scheduledAt !== undefined) {
        if (!req.body.scheduledAt) {
          patch.scheduledAt = null;
          patch.status = 'draft';
        } else {
          const when = new Date(req.body.scheduledAt);
          if (Number.isNaN(when.getTime())) throw badRequest('scheduledAt must be an ISO date');
          if (when.getTime() <= Date.now()) throw badRequest('scheduledAt must be in the future');
          patch.scheduledAt = when.toISOString();
          patch.status = 'scheduled';
        }
      }
      const updated = await store.patch('posts.json', post.id, patch);
      res.json({ post: updated });
    })
  );

  router.post(
    '/posts/:id/publish',
    asyncRoute(async (req, res) => {
      const outcome = await publishPost(ctx, req.params.id);
      if (outcome.error) {
        return res.status(502).json({
          error: { code: 'bad_gateway', message: outcome.error.message },
          post: outcome.post,
        });
      }
      res.json({ post: outcome.post });
    })
  );

  router.post(
    '/posts/:id/schedule',
    asyncRoute(async (req, res) => {
      const post = store.find('posts.json', req.params.id);
      if (!post) throw notFound('Post');
      if (post.status === 'published') throw badRequest('Published posts cannot be rescheduled');
      const when = new Date(req.body?.scheduledAt ?? '');
      if (Number.isNaN(when.getTime())) throw badRequest('scheduledAt is required (ISO date)');
      if (when.getTime() <= Date.now()) throw badRequest('scheduledAt must be in the future');
      const updated = await store.patch('posts.json', post.id, { status: 'scheduled', scheduledAt: when.toISOString(), error: null });
      logger.info('posts', 'post scheduled', { id: post.id, scheduledAt: when.toISOString() });
      res.json({ post: updated });
    })
  );

  router.post(
    '/posts/:id/cancel',
    asyncRoute(async (req, res) => {
      const post = store.find('posts.json', req.params.id);
      if (!post) throw notFound('Post');
      if (post.status !== 'scheduled') throw badRequest('Only scheduled posts can be cancelled');
      const updated = await store.patch('posts.json', post.id, { status: 'cancelled' });
      logger.info('posts', 'post cancelled', { id: post.id });
      res.json({ post: updated });
    })
  );

  router.delete(
    '/posts/:id',
    asyncRoute(async (req, res) => {
      const removed = await store.remove('posts.json', req.params.id);
      if (!removed) throw notFound('Post');
      res.json({ ok: true });
    })
  );

  // Manual tick for tests: publishes everything that is due now.
  router.post(
    '/posts/scheduler/tick',
    asyncRoute(async (req, res) => {
      const results = await schedulerTick(ctx);
      res.json({ published: results.length, results });
    })
  );

  return router;
}

function withoutText(generated) {
  const { text, ...rest } = generated;
  return { ...rest, chars: text?.length ?? 0 };
}
