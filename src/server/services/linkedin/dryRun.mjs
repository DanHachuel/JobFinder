/**
 * JobFinder — dry-run LinkedIn client (simulation).
 *
 * Used when no LinkedIn channel is connected OR when global dry-run is on
 * (the default). Everything returns realistic data flagged with
 * `simulated: true` so the UI can show a DRY-RUN badge, and no real
 * request ever leaves the machine.
 */
const FIRST_NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Heitor', 'Isabela', 'Joao', 'Larissa', 'Marcelo', 'Natalia', 'Otavio', 'Paula', 'Rafael', 'Sofia', 'Thiago', 'Vanessa', 'William'];
const LAST_NAMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Ribeiro', 'Carvalho'];
const HEADLINES = [
  'Tech Recruiter | Talent Acquisition',
  'Engineering Manager @ Fintech',
  'Head of Data & Analytics',
  'Senior Backend Engineer (Node.js)',
  'Product Manager | B2B SaaS',
  'CTO | Startup em escala',
  'Full Stack Developer | React & Node',
  'Headhunter para posicoes de tech',
  'Diretor de Engenharia',
  'DevOps / SRE Specialist',
];
const LOCATIONS = ['Sao Paulo, Brasil', 'Rio de Janeiro, Brasil', 'Belo Horizonte, Brasil', 'Remoto (Brasil)', 'Lisboa, Portugal', 'Porto Alegre, Brasil', 'Curitiba, Brasil', 'Remoto (Global)'];
const COMPANIES = ['Nubank', 'iFood', 'Mercado Livre', 'Stone', 'PicPay', 'Loft', 'Gympass', 'Result Audiovisual', 'Itau', 'XP Inc.'];
const JOB_TITLES = [
  'Engenheiro(a) de Software Senior',
  'Product Manager',
  'Tech Recruiter',
  'Data Analyst',
  'DevOps Engineer',
  'Frontend Engineer (React)',
  'Backend Engineer (Node.js)',
  'Engineering Manager',
  'UX Designer',
  'Gerente de Produtos Digitais',
];

function pick(list, seed) {
  return list[Math.floor(seed * list.length) % list.length];
}

function pseudoRandom(seedText, index) {
  let hash = 0;
  const text = `${seedText}:${index}`;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100000;
  }
  return (hash % 1000) / 1000;
}

export class DryRunLinkedInClient {
  constructor(logger) {
    this.logger = logger;
    this.mode = 'dry-run';
  }

  async getProfile() {
    return { id: 'demo-user', firstName: 'Demo', lastName: '(dry-run)', headline: 'JobFinder dry-run profile', simulated: true };
  }

  async testAuth() {
    return { ok: true, simulated: true, mode: 'dry-run', message: 'dry-run ativo — nenhuma chamada real ao LinkedIn' };
  }

  async searchPeople(keyword) {
    const people = [];
    for (let i = 0; i < 12; i += 1) {
      const rand = pseudoRandom(keyword ?? 'seed', i);
      const firstName = pick(FIRST_NAMES, rand + i * 0.07);
      const lastName = pick(LAST_NAMES, rand + i * 0.11 + 0.13);
      people.push({
        profileUrn: `urn:li:fsd_profile:demo${i}`,
        profileId: `demo-${i}`,
        firstName,
        lastName,
        headline: pick(HEADLINES, rand + i * 0.05),
        location: pick(LOCATIONS, rand + i * 0.03),
        simulated: true,
      });
    }
    this.logger?.info('linkedin:dry-run', 'searchPeople simulated', { keyword, count: people.length });
    return people;
  }

  async sendInvitation({ profileId }) {
    this.logger?.info('linkedin:dry-run', 'invitation simulated', { profileId });
    return { ok: true, simulated: true, profileId };
  }

  async getConversations() {
    return [
      { conversationId: 'demo-conv-1', title: 'Ana Silva', unread: true, lastActivityAt: new Date().toISOString(), participants: [], simulated: true },
      { conversationId: 'demo-conv-2', title: 'Bruno Santos', unread: false, lastActivityAt: new Date().toISOString(), participants: [], simulated: true },
    ];
  }

  async getConversationEvents(conversationId) {
    return [
      { eventId: `demo-ev-${conversationId}-1`, createdAt: new Date().toISOString(), body: 'Oi! Obrigado pelo convite.', fromName: 'Contato', fromUrn: null, simulated: true },
    ];
  }

  async sendMessage({ profileUrn, text }) {
    this.logger?.info('linkedin:dry-run', 'message simulated', { profileUrn, chars: text?.length ?? 0 });
    return { ok: true, conversationId: `demo-conv-${Date.now()}`, simulated: true };
  }

  async sendMessageToConversation(conversationId, text) {
    this.logger?.info('linkedin:dry-run', 'conversation message simulated', { conversationId });
    return { ok: true, conversationId, simulated: true };
  }

  async createPost({ text }) {
    this.logger?.info('linkedin:dry-run', 'post simulated', { chars: text?.length ?? 0 });
    return { id: `urn:li:ugcPost:demo-${Date.now()}`, simulated: true };
  }

  async searchJobs(filters = {}) {
    const jobs = [];
    for (let i = 0; i < 10; i += 1) {
      const rand = pseudoRandom(JSON.stringify(filters), i);
      jobs.push({
        jobId: `demo-job-${i}`,
        title: pick(JOB_TITLES, rand + i * 0.09),
        company: pick(COMPANIES, rand + i * 0.04),
        location: filters.remote ? 'Remoto (Brasil)' : pick(LOCATIONS, rand + i * 0.02),
        listedAt: new Date(Date.now() - i * 86400000).toISOString(),
        easyApply: i % 3 !== 0,
        url: `https://www.linkedin.com/jobs/view/demo-job-${i}`,
        description: buildJobDescription(pick(JOB_TITLES, rand + i * 0.09)),
        simulated: true,
      });
    }
    this.logger?.info('linkedin:dry-run', 'jobs search simulated', { filters, count: jobs.length });
    return jobs;
  }
}

function buildJobDescription(title) {
  return `Sobre a vaga: estamos buscando ${title} para integrar nosso time.\n\n` +
    'Requisitos: 3+ anos de experiencia, trabalho em equipe, comunicacao clara.\n' +
    'Diferenciais: ingles avancado, experiencia com metodologias ageis, atuacao previa em produtos digitais.\n\n' +
    'Beneficios: vale-refeicao, plano de saude, auxilio home-office, horario flexivel.';
}
