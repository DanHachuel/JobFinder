/**
 * JobFinder — semantic resume/job matcher.
 *
 * Local-first scoring (TF-IDF + cosine), ported from
 * Parthshewale18/AI-Resume-Job-Matcher (TF-IDF/Transformer) — chosen over
 * a transformer to keep everything offline and dependency-free; Ollama /
 * OpenAI / Anthropic remain available in config for other features.
 *
 * The raw cosine similarity of two short documents is harshly low, so the
 * final score applies a concave calibration (sqrt) that keeps 0 and 1
 * intact while giving partial matches a fair, readable percentage.
 */

const STOPWORDS = new Set([
  'de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'nao', 'uma', 'os', 'no', 'se',
  'na', 'por', 'mais', 'as', 'dos', 'como', 'mas', 'ao', 'ele', 'das', 'à', 'seu', 'sua', 'ou', 'quando',
  'muito', 'nos', 'ja', 'eu', 'tambem', 'so', 'pelo', 'para', 'the', 'and', 'for', 'you', 'with', 'our',
  'are', 'this', 'that', 'will', 'have', 'from', 'your', 'job', 'work', 'we', 'is', 'in', 'to', 'of', 'on',
  'a', 'an', 'as', 'at', 'be', 'by', 'it', 'or', 'us', 'was', 'were', 'has', 'all', 'other', 'their',
  'about', 'can', 'if', 'which', 'who', 'what', 'when', 'where', 'how', 'than', 'then', 'them', 'these',
]);

/** Lowercase, strip accents and punctuation, drop stopwords. */
export function tokenize(text) {
  const normalized = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .replace(/\s+/g, ' ');
  return normalized
    .split(' ')
    .map((token) => token.replace(/^[-.]+|[-.]+$/g, ''))
    .map((token) => token.replace(/\.js$/, '')) // node.js -> node, react.js -> react
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function termFrequency(tokens) {
  const tf = new Map();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  const total = tokens.length || 1;
  for (const [token, count] of tf) tf.set(token, count / total);
  return tf;
}

function idf(documents) {
  const idf = new Map();
  const n = documents.length;
  for (const doc of documents) {
    for (const token of new Set(doc)) idf.set(token, (idf.get(token) ?? 0) + 1);
  }
  for (const [token, count] of idf) idf.set(token, Math.log((n + 1) / (count + 1)) + 1);
  return idf;
}

/** Vector for one document given the idf table. */
function vector(tf, idf) {
  const vec = new Map();
  for (const [token, freq] of tf) {
    const weight = freq * (idf.get(token) ?? 1);
    if (weight) vec.set(token, weight);
  }
  return vec;
}

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [, value] of a) normA += value * value;
  for (const [token, value] of b) {
    normB += value * value;
    const other = a.get(token);
    if (other) dot += other * value;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Match a resume against a job description.
 * @param {object} resume parsed resume (text + skills)
 * @param {object} job    { title, company, description, location }
 * @returns {{ score:number, skillGaps:string[], matchedSkills:string[], coverage:number }}
 */
export function matchScore(resume, job) {
  const resumeText = resume?.text ?? '';
  const jobText = `${job?.title ?? ''} ${job?.description ?? ''} ${job?.company ?? ''}`;
  if (!resumeText.trim() || !jobText.trim()) {
    return { score: 0, skillGaps: [], matchedSkills: [], coverage: 0 };
  }

  const resumeTokens = tokenize(resumeText);
  const jobTokens = tokenize(jobText);
  const idfTable = idf([resumeTokens, jobTokens]);
  const similarity = cosine(vector(termFrequency(jobTokens), idfTable), vector(termFrequency(resumeTokens), idfTable));
  const score = Math.round(Math.min(1, Math.sqrt(Math.max(0, similarity))) * 100);

  const resumeSkills = new Set((resume?.skills ?? []).map((s) => s.toLowerCase()));
  const jobSkills = extractSkills(jobText);
  const matchedSkills = jobSkills.filter((skill) => resumeSkills.has(skill) || resumeText.toLowerCase().includes(skill));
  const skillGaps = jobSkills.filter((skill) => !matchedSkills.includes(skill));

  return { score, skillGaps, matchedSkills, coverage: jobSkills.length ? matchedSkills.length / jobSkills.length : 0 };
}

/** Skills mentioned in a free text (job description). */
export function extractSkills(text) {
  const lower = String(text ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return SKILL_KEYWORDS.filter((skill) => lower.includes(skill));
}

/** Human recommendation from a score. */
export function recommend(score) {
  if (score >= 75) return 'Candidate-se: alta aderencia com a vaga.';
  if (score >= 50) return 'Vale a candidatura: enderece as lacunas na carta de apresentacao.';
  if (score >= 30) return 'Candidate-se com ressalvas: metade dos requisitos nao aparece no seu curriculo.';
  return 'Baixa aderencia: invista em outro resultado ou fortaleca as skills faltantes.';
}

const SKILL_KEYWORDS = [
  'javascript', 'typescript', 'node', 'node.js', 'react', 'react.js', 'vue', 'angular', 'next.js',
  'python', 'java', 'c#', '.net', 'go', 'golang', 'rust', 'php', 'ruby', 'kotlin', 'swift',
  'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'oracle',
  'aws', 'azure', 'gcp', 'google cloud', 'docker', 'kubernetes', 'terraform', 'ci/cd', 'devops',
  'git', 'github', 'gitlab', 'jira', 'agile', 'scrum', 'kanban',
  'html', 'css', 'tailwind', 'sass', 'figma', 'ux', 'ui design',
  'data analysis', 'analise de dados', 'machine learning', 'data science', 'ciencia de dados', 'pandas', 'spark', 'airflow', 'etl',
  'excel', 'power bi', 'tableau', 'looker',
  'salesforce', 'hubspot', 'crm', 'erp', 'sap',
  'ingles', 'english', 'espanhol', 'frances', 'alemao',
  'product management', 'gestao de produtos', 'roadmap', 'okr', 'kpi',
  'marketing', 'seo', 'google ads', 'midia paga', 'growth',
  'vendas', 'sales', 'inside sales', 'sdr', 'bdr', 'account executive', 'customer success',
  'recrutamento', 'recruiting', 'talent acquisition', 'people analytics',
  'financas', 'financeiro', 'controladoria', 'contabilidade',
  'atendimento', 'sac', 'suporte',
  'lideranca', 'gestao de times', 'people management', 'mentoria',
];
