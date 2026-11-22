/**
 * PM2 — JobFinder como serviço de background real (Windows e Linux).
 *
 *   npm i -g pm2            # ou: npx pm2
 *   npm run start:daemon    # sobe
 *   npm run daemon:logs     # acompanha
 *   npm run daemon:stop     # para
 *
 * O CLI continua sendo o entrypoint: toda a supervisão do worker, os sinais
 * e o keep-alive do event loop são os mesmos do modo foreground. O PM2 apenas
 * garante que o processo sobreviva ao fechamento do terminal e reinicia em
 * caso de crash.
 */
module.exports = {
  apps: [
    {
      name: 'jobfinder',
      script: 'scripts/cli.mjs',
      interpreter: 'node',
      // Modo serviço: não trava o terminal e sobrevive ao fechamento da sessão.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      // Logs por processo fiquem em ~/.jobfinder (o PM2 gerencia os seus em
      // ~/.pm2/logs; aqui o app escreve o log de aplicação).
      out_file: null,
      error_file: null,
      env: {
        NODE_ENV: 'production',
        JOBFINDER_MODE: 'daemon',
      },
    },
  ],
};