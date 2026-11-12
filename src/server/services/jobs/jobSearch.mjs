/**
 * JobFinder — job search + save/discard (§5.3.2).
 *
 * Search goes through the LinkedIn facade (dry-run when disconnected) and
 * every result is scored against the local resume. Saved/discarded jobs
 * persist in jobs.json with their score and skill gaps.
 */
import { HttpError } from '../../middleware/errors.mjs';
import { matchScore, recommend } from './matcher.mjs';
import { createLinkedInClient } from '../linkedin/index.mjs';

/** Build the search filters from the request body. */
export function buildFilters(body = {}) {
  return {
    title: String(body.title ?? '').trim(),
    location: String(body.location ?? '').trim(),
    remote: Boolean(body.remote),
    salary: body.salary ? String(body.salary) : null,
  };
}

/** Run the search and score results against the resume. */
export async function searchJobs(ctx, filters) {
  const { store, logger, config, rateLimiter } = ctx;
  const { client, mode } = createLinkedInClient({ store, logger, config, rateLimiter });
  if (!filters.title && !filters.keywords) {
    throw new HttpError(400, 'bad_request', 'Informe ao menos o cargo desejado (title).');
  }
  const found = await client.searchJobs(filters);
  const resume = store.read('resume.json', null);
  const jobs = found.map((job) => scoreJob(job, resume));
  jobs.sort((a, b) => b.matchScore - a.matchScore);
  logger.info('jobs', 'job search', { filters, found: jobs.length, mode });
  return { jobs, mode, simulated: jobs.some((j) => j.simulated) };
}

/** Attach the match score + gaps to a job. */
export function scoreJob(job, resume) {
  const hasResume = Boolean(resume?.text);
  const match = hasResume ? matchScore(resume, job) : { score: 0, skillGaps: [], matchedSkills: [], coverage: 0 };
  return {
    ...job,
    matchScore: match.score,
    skillGaps: match.skillGaps,
    matchedSkills: match.matchedSkills,
    recommendation: hasResume ? recommend(match.score) : 'Envie seu curriculo para ver o match.',
  };
}

/** Persist a search result as saved/discarded. */
export async function saveJob(ctx, job, status) {
  const { store, logger } = ctx;
  if (!['saved', 'discarded'].includes(status)) {
    throw new HttpError(400, 'bad_request', 'status must be "saved" or "discarded"');
  }
  const existing = store.list('jobs.json').find((j) => j.jobId === job.jobId);
  if (existing) {
    const updated = await store.patch('jobs.json', existing.id, { status, matchScore: job.matchScore ?? existing.matchScore });
    return updated;
  }
  const created = await store.create(
    'jobs.json',
    {
      jobId: job.jobId,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url,
      description: job.description,
      easyApply: job.easyApply ?? null,
      status,
      matchScore: job.matchScore ?? 0,
      skillGaps: job.skillGaps ?? [],
      matchedSkills: job.matchedSkills ?? [],
      recommendation: job.recommendation ?? null,
      simulated: Boolean(job.simulated),
    },
    'job'
  );
  logger.info('jobs', `job ${status}`, { jobId: created.jobId, title: created.title });
  return created;
}

/** Change the status of a stored job. */
export async function setJobStatus(ctx, id, status) {
  const { store, logger } = ctx;
  const allowed = ['new', 'saved', 'discarded', 'applied'];
  if (!allowed.includes(status)) {
    throw new HttpError(400, 'bad_request', `status must be one of ${allowed.join(', ')}`);
  }
  const job = store.find('jobs.json', id);
  if (!job) throw new HttpError(404, 'not_found', 'Job not found');
  const updated = await store.patch('jobs.json', id, { status });
  logger.info('jobs', 'job status changed', { id, status });
  return updated;
}
