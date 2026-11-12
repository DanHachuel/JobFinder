/**
 * JobFinder — topics routes (§5.1.1).
 *
 *   GET    /api/topics        list themes for automatic posts
 *   POST   /api/topics        create a theme
 *   PUT    /api/topics/:id    update
 *   DELETE /api/topics/:id    delete
 */
import { Router } from 'express';

import { asyncRoute, badRequest, notFound } from '../middleware/errors.mjs';

export function topicsRoutes({ store, logger }) {
  const router = Router();

  router.get(
    '/topics',
    asyncRoute((req, res) => {
      const topics = store.list('topics.json');
      const used = new Map();
      for (const post of store.list('posts.json')) {
        if (!post.topicId) continue;
        used.set(post.topicId, (used.get(post.topicId) ?? 0) + 1);
      }
      res.json({
        topics: topics
          .slice()
          .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
          .map((t) => ({ ...t, postsCount: used.get(t.id) ?? 0 })),
      });
    })
  );

  router.post(
    '/topics',
    asyncRoute(async (req, res) => {
      const { name, prompt, active = true } = req.body ?? {};
      if (!name || !String(name).trim()) throw badRequest('name is required');
      const topic = await store.create(
        'topics.json',
        {
          name: String(name).trim().slice(0, 120),
          prompt: prompt ? String(prompt).slice(0, 500) : '',
          active: Boolean(active),
        },
        'topic'
      );
      logger.info('topics', 'topic created', { id: topic.id, name: topic.name });
      res.status(201).json({ topic });
    })
  );

  router.put(
    '/topics/:id',
    asyncRoute(async (req, res) => {
      const topic = store.find('topics.json', req.params.id);
      if (!topic) throw notFound('Topic');
      const patch = {};
      if (req.body?.name !== undefined) {
        if (!String(req.body.name).trim()) throw badRequest('name cannot be empty');
        patch.name = String(req.body.name).trim().slice(0, 120);
      }
      if (req.body?.prompt !== undefined) patch.prompt = String(req.body.prompt).slice(0, 500);
      if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);
      const updated = await store.patch('topics.json', topic.id, patch);
      res.json({ topic: updated });
    })
  );

  router.delete(
    '/topics/:id',
    asyncRoute(async (req, res) => {
      const removed = await store.remove('topics.json', req.params.id);
      if (!removed) throw notFound('Topic');
      logger.info('topics', 'topic removed', { id: req.params.id });
      res.json({ ok: true });
    })
  );

  return router;
}
