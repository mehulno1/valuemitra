/**
 * PM2 Ecosystem Config — ValueMitra
 * Run with: pm2 start infrastructure/pm2/ecosystem.config.cjs
 * Reload with: pm2 reload valuemitra-api
 */

module.exports = {
  apps: [
    {
      name: 'valuemitra-api',
      script: 'apps/api/dist/index.js',

      // Working directory — must be the project root
      cwd: '/var/www/valuemitra',

      // Fork mode: single process, easy to reason about
      // Switch to cluster_mode + instances:'max' for multi-core scaling later
      exec_mode: 'fork',
      instances: 1,

      // Auto-restart if memory exceeds 500 MB
      max_memory_restart: '500M',

      // Always restart on crash
      autorestart: true,
      watch: false,                   // never watch in production

      // Delays between restarts
      min_uptime: '10s',
      max_restarts: 10,

      // Logs
      out_file: '/var/log/valuemitra/api-out.log',
      error_file: '/var/log/valuemitra/api-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Environment — production
      env: {
        NODE_ENV: 'production',
        PORT: 3006,
      },

      // Graceful shutdown — give in-flight requests 10s to finish
      kill_timeout: 10000,
      listen_timeout: 10000,
    },
  ],
};
