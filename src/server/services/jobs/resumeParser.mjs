/**
 * JobFinder — resume parser (PDF / DOCX / TXT).
 *
 * Extracts plain text locally (pdfjs-dist for PDF, mammoth for DOCX) and
 * derives a structured profile: skills, titles, years of experience,
 * education and languages. Nothing leaves the machine.
 */

const SKILL_KEYWORDS = [
  // tech
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
  // product / business
  'product management', 'gestao de produtos', 'roadmap', 'okr', 'kpi',
  'marketing', 'seo', 'google ads', 'midia paga', 'growth',
  'vendas', 'sales', 'inside sales', 'sdr', 'bdr', 'account executive', 'customer success',
  'recrutamento', 'recruiting', 'talent acquisition', 'people analytics', 'rh', 'dp',
  'financas', 'financeiro', 'controladoria', 'contabilidade', 'fp&a',
  'atendimento', 'sac', 'suporte', 'help desk',
  'lideranca', 'gestao de times', 'people management', 'mentoria',
];

const EDUCATION_KEYWORDS = [
  'bacharel', 'bacharelado', 'graduacao', 'graduado', 'superior',
  'licenciatura', 'tecnologo', 'pos-graduacao', 'especializacao', 'mestrado', 'doutorado', 'mba', 'phd',
  'bachelor', 'master', 'mba', 'b.s.', 'b.a.', 'm.s.',
];

const LANGUAGE_KEYWORDS = ['ingles', 'english', 'espanhol', 'spanish', 'frances', 'french', 'alemao', 'german', 'mandarim', 'japanese', 'italiano'];

/** Extract text from a file buffer according to its mime type. */
export async function extractText(buffer, mimeType = '') {
  const type = mimeType.toLowerCase();
  if (type.includes('pdf') || (!type && buffer.subarray(0, 5).toString() === '%PDF-')) {
    return extractPdfText(buffer);
  }
  if (type.includes('wordprocessingml') || type.includes('docx') || (!type && buffer.subarray(0, 2).toString() === 'PK')) {
    return extractDocxText(buffer);
  }
  if (type.includes('text') || type.includes('plain')) {
    return buffer.toString('utf8');
  }
  throw Object.assign(new Error(`Formato nao suportado: ${mimeType || 'desconhecido'}. Envie PDF, DOCX ou TXT.`), { status: 400, code: 'bad_request' });
}

async function extractPdfText(buffer) {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
    const chunks = [];
    for (let page = 1; page <= doc.numPages; page += 1) {
      const content = await doc.getPage(page);
      const textContent = await content.getTextContent();
      chunks.push(textContent.items.map((item) => (typeof item.str === 'string' ? item.str : '')).join(' '));
    }
    await doc.destroy();
    return chunks.join('\n');
  } catch (err) {
    throw Object.assign(new Error(`Falha ao ler o PDF: ${err.message}`), { status: 400, code: 'bad_request' });
  }
}

async function extractDocxText(buffer) {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? '';
  } catch (err) {
    throw Object.assign(new Error(`Falha ao ler o DOCX: ${err.message}`), { status: 400, code: 'bad_request' });
  }
}

/** Derive the structured profile from plain text. */
export function parseResume(text) {
  const clean = String(text ?? '').replace(/\r/g, '');
  const lower = clean.toLowerCase();

  const skills = unique(SKILL_KEYWORDS.filter((skill) => lower.includes(skill)));
  const education = unique(
    clean
      .split(/\n+/)
      .filter((line) => EDUCATION_KEYWORDS.some((kw) => line.toLowerCase().includes(kw)))
      .map((line) => line.trim())
      .filter((line) => line.length > 3 && line.length < 140)
      .slice(0, 6)
  );
  const languages = unique(LANGUAGE_KEYWORDS.filter((lang) => lower.includes(lang)).map(prettyLanguage));

  const yearsMatch = lower.match(/(\d{1,2})\s*(?:\+)?\s*anos de experiencia/);
  const titles = guessTitles(clean);

  return {
    text: clean,
    skills,
    titles,
    yearsExperience: yearsMatch ? Number(yearsMatch[1]) : null,
    education,
    languages,
  };
}

function guessTitles(text) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const candidates = lines
    .slice(0, 12)
    .filter((line) =>
      /^(desenvolvedor|engenheiro|analista|gerente|coordenador|diretor|especialista|consultor|tech lead|product manager|designer|estag|sdr|bdr|vendedor|recrutador)/i.test(line)
      && line.length < 80
    )
    .slice(0, 5);
  if (candidates.length) return candidates;
  const roleLine = text.match(/(?:cargo|posicao|posição)\s*[:\-]\s*(.+)/i);
  return roleLine ? [roleLine[1].trim().slice(0, 80)] : [];
}

function prettyLanguage(lang) {
  const map = { english: 'Ingles', spanish: 'Espanhol', french: 'Frances', german: 'Alemao', japanese: 'Japones' };
  const key = lang.toLowerCase();
  const pretty = map[key] ?? lang;
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}
