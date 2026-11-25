/**
 * PM2 — JobFinder como serviço de background real (Windows e Linux).
 *
 *   npm i -g pm2             # ou: npx pm2
 *   npm run pm2:start        # sobe
 *   npm run daemon:logs      # acompanha
 *   npm run pm2:stop         # para
 *
 * ATENÇÃO (0.1.17): `scripts/cli.mjs` agora é o LAUNCHER — ele copia o runtime
 * permanente para ~/.jobfinder/runtime, sobe o servidor DESTACADO e retorna.
 * Um PM2 que apontasse para o launcher acharia que o app "encerrou" logo após
 * subir. Por isso o PM2 roda o servidor do runtime em `--foreground`: o PM2
 * supervisiona um processo de vida longa, e o `stop` do CLI continua sendo o
 * caminho manual.
 *
 * O script é resolvido em runtime: o launcher garante que o runtime exista.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = process.env.JOBFINDER_HOME || process.env.JOBFINDER_DATA_DIR || path.join(os.homedir(), '.jobfinder');
const runtimeServer = path.join(home, 'runtime', 'src', 'server', 'index.mjs');
const repoServer = path.resolve(__dirname, 'src', 'server', 'index.mjs');
const script = fs.existsSync(runtimeServer) ? runtimeServer : repoServer;

module.exports = {
  apps: [
    {
      name: 'jobfinder',
      script,
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: null,
      error_file: null,
      env: {
        NODE_ENV: 'production',
        JOBFINDER_MODE: 'daemon',
      },
    },
  ],
};