/**
 * JobFinder — jobs routes (§5.3).
 *
 *   POST /api/resume                  upload resume (raw body PDF/DOCX/TXT)
 *   GET  /api/resume                  current parsed resume
 *   POST /api/jobs/search             { title, location, remote, salary } -> scored jobs
 *   GET  /api/jobs                    stored jobs (?status=saved&page=)
 *   POST /api/jobs                    save a search result { job }
 *   POST /api/jobs/:id/status         change status (saved/discarded/applied)
 *   POST /api/jobs/:id/match          re-score an existing job
 *   GET  /api/jobs/stats              dashboard counters
 */
import express, { Router } from 'express';

import { asyncRoute, notFound } from '../middleware/errors.mjs';
import { extractText, parseResume } from '../services/jobs/resumeParser.mjs';
import { searchJobs, saveJob, setJobStatus, scoreJob } from '../services/jobs/jobSearch.mjs';

export function jobsRoutes(ctx) {
  const { store, logger, config } = ctx;
  const router = Router();

  router.get(
    '/resume',
    asyncRoute((req, res) => {
      const resume = store.read('resume.json', null);
      res.json({ resume });
    })
  );

  router.post(
    '/resume',
    express.raw({ type: () => true, limit: '8mb' }),
    asyncRoute(async (req, res) => {
      const fileName = String(req.query.fileName ?? 'curriculo');
      const mimeType = String(req.query.mimeType ?? req.headers['content-type'] ?? '');
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''), 'utf8');
      if (!buffer.length) {
        throw Object.assign(new Error('Arquivo vazio.'), { status: 400, code: 'bad_request' });
      }
      const text = await extractText(buffer, mimeType || fileName);
      const parsed = parseResume(text);
      const resume = await store.update('resume.json', () => ({
        uploadedAt: new Date().toISOString(),
        fileName,
        mimeType: mimeType || null,
        text: parsed.text,
        skills: parsed.skills,
        titles: parsed.titles,
        yearsExperience: parsed.yearsExperience,
        education: parsed.education,
        languages: parsed.languages,
      }));
      logger.info('jobs', 'resume parsed', { fileName, chars: parsed.text.length, skills: parsed.skills.length });
      res.status(201).json({ resume });
    })
  );

  router.post(
    '/jobs/search',
    asyncRoute(async (req, res) => {
      const result = await searchJobs(ctx, req.body ?? {});
      res.json(result);
    })
  );

  router.get(
    '/jobs',
    asyncRoute((req, res) => {
      const { status, minScore } = req.query;
      const where = (job) => {
        if (status && job.status !== status) return false;
        if (minScore && (job.matchScore ?? 0) < Number(minScore)) return false;
        return true;
      };
      res.json(
        store.query('jobs.json', {
          where,
          sort: 'matchScore',
          order: 'desc',
          page: Number(req.query.page) || 1,
          limit: Number(req.query.limit) || 20,
        })
      );
    })
  );

  router.post(
    '/jobs',
    asyncRoute(async (req, res) => {
      const job = req.body?.job ?? req.body;
      const saved = await saveJob(ctx, job, req.body?.status ?? 'saved');
      res.status(201).json({ job: saved });
    })
  );

  router.post(
    '/jobs/:id/status',
    asyncRoute(async (req, res) => {
      const updated = await setJobStatus(ctx, req.params.id, req.body?.status);
      res.json({ job: updated });
    })
  );

  router.post(
    '/jobs/:id/match',
    asyncRoute(async (req, res) => {
      const job = store.find('jobs.json', req.params.id);
      if (!job) throw notFound('Job');
      const resume = store.read('resume.json', null);
      const scored = scoreJob(job, resume);
      const updated = await store.patch('jobs.json', job.id, {
        matchScore: scored.matchScore,
        skillGaps: scored.skillGaps,
        matchedSkills: scored.matchedSkills,
        recommendation: scored.recommendation,
      });
      res.json({ job: updated });
    })
  );

  router.get(
    '/jobs/stats',
    asyncRoute((req, res) => {
      const jobs = store.list('jobs.json');
      const byStatus = {};
      let scoreSum = 0;
      let scored = 0;
      for (const job of jobs) {
        byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
        if (typeof job.matchScore === 'number' && job.matchScore > 0) {
          scoreSum += job.matchScore;
          scored += 1;
        }
      }
      const resume = store.read('resume.json', null);
      res.json({
        total: jobs.length,
        byStatus,
        averageScore: scored ? Math.round(scoreSum / scored) : 0,
        resumeLoaded: Boolean(resume?.text),
        skillsFound: resume?.skills?.length ?? 0,
      });
    })
  );

  return router;
}
