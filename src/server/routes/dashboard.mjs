/**
 * JobFinder — dashboard aggregation route.
 *
 * One call that feeds the Painel page: connection status, module counters,
 * 7-day publishing history, invitations per day and job funnel — the
 * numbers behind the LeadMaster-style cards and charts.
 */
import { Router } from 'express';

import { asyncRoute } from '../middleware/errors.mjs';
import { createLinkedInClient } from '../services/linkedin/index.mjs';
import { invitationsQuota } from '../services/outreach/invitations.mjs';
import { dailyDmState } from '../services/outreach/cascades.mjs';
import { applicationsQuota } from '../services/jobs/easyApply.mjs';

export function dashboardRoutes(ctx) {
  const { store, logger, config, rateLimiter } = ctx;
  const router = Router();

  router.get(
    '/dashboard',
    asyncRoute(async (req, res) => {
      const { mode } = createLinkedInClient({ store, logger, config, rateLimiter });
      const channel = store.list('channels.json').find((c) => c.status === 'active') ?? null;

      const posts = store.list('posts.json');
      const connections = store.list('connections.json');
      const cascades = store.list('dm-cascades.json');
      const jobs = store.list('jobs.json');
      const applications = store.list('applications.json');

      const postsByStatus = countBy(posts, 'status');
      const jobsByStatus = countBy(jobs, 'status');
      const appsByStatus = countBy(applications, 'status');

      // Published posts per day (last 7 days) — bar chart.
      const publishedSeries = daySeries(posts.filter((p) => p.publishedAt), 'publishedAt', 7);
      // Invitations sent per day (last 14 days) — bar chart.
      const invitationsSeries = daySeries(connections.filter((c) => c.sentAt && c.status === 'sent'), 'sentAt', 14);

      const dmTotalSent = cascades.flatMap((c) => c.steps ?? []).filter((s) => s.status === 'sent').length;
      const dmTotalPending = cascades.flatMap((c) => c.steps ?? []).filter((s) => s.status === 'pending').length;

      res.json({
        connection: { mode, connected: mode !== 'dry-run', channel: channel?.label ?? null, authMode: channel?.authMode ?? null },
        posts: {
          total: posts.length,
          byStatus: postsByStatus,
          publishedLast7Days: publishedSeries.map((d) => d.count).reduce((a, b) => a + b, 0),
          scheduledUpcoming: posts.filter((p) => p.status === 'scheduled').length,
          series: publishedSeries,
        },
        connections: {
          total: connections.length,
          sent: connections.filter((c) => c.status === 'sent').length,
          quota: invitationsQuota(store, config),
          series: invitationsSeries,
        },
        dms: {
          cascades: cascades.length,
          activeCascades: cascades.filter((c) => c.status === 'active').length,
          waitingReply: cascades.filter((c) => c.status === 'waiting_reply').length,
          stepsSent: dmTotalSent,
          stepsPending: dmTotalPending,
          daily: dailyDmState(store, config),
        },
        jobs: {
          total: jobs.length,
          byStatus: jobsByStatus,
          averageScore: average(jobs.map((j) => j.matchScore).filter((s) => typeof s === 'number' && s > 0)),
        },
        applications: {
          total: applications.length,
          byStatus: appsByStatus,
          quota: applicationsQuota(store, config),
        },
        logs: logger.tail(10),
        dryRun: config.dryRun !== false,
      });
    })
  );

  return router;
}

function countBy(list, field) {
  const out = {};
  for (const item of list) out[item[field]] = (out[item[field]] ?? 0) + 1;
  return out;
}

function daySeries(list, dateField, days) {
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - i);
    const key = day.toISOString().slice(0, 10);
    const count = list.filter((item) => (item[dateField] ?? '').startsWith(key)).length;
    series.push({ day: key, count });
  }
  return series;
}

function average(numbers) {
  if (!numbers.length) return 0;
  return Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length);
}
