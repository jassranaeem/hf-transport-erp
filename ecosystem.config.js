// PM2 process config for a bare VPS deploy.
//   npm ci && npm run build
//   pm2 start ecosystem.config.js --env production
//
// NOTE: single instance. The app runs an in-process cron scheduler, the GPS
// signal-loss sweep and socket.io without a Redis adapter, so running multiple
// workers would duplicate scheduled jobs and break real-time fan-out. To scale
// horizontally, add a socket.io Redis adapter + cron leader-election first.
module.exports = {
  apps: [
    {
      name: "hf-transport-erp",
      script: "./dist/server.cjs",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "512M",
      kill_timeout: 16000, // give graceful shutdown time to finish
      env_file: ".env.production",
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
        TRUST_PROXY: "1",
        MIGRATE_ON_BOOT: "true",
      },
      error_file: "./logs/pm2-err.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      combine_logs: true,
    },
  ],
};
