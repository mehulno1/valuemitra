// PM2: one API process (it also runs the job worker and the daily retention task).
module.exports = {
  apps: [
    {
      name: 'valuemitra-v2',
      cwd: __dirname + '/../..',
      script: 'apps/api/dist/index.js',
      node_args: '--env-file=.env --enable-source-maps',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '700M',
      out_file: '/var/log/valuemitra-v2/api-out.log',
      error_file: '/var/log/valuemitra-v2/api-error.log',
      time: true,
    },
  ],
};
