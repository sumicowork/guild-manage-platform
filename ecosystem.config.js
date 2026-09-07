module.exports = {
  apps: [{
    name: 'guild-platform',
    cwd: '/opt/guild-manage-platform',
    script: '.next/standalone/server.js',
    exec_mode: 'fork',
    instances: 1,
    // 注意：不要加 max_memory_restart！Next 16 standalone 启动瞬间 RSS 峰值
    // 超 512M，PM2 每秒检测触发 SIGINT 杀进程 → 无限重启循环（已验证）
    // 密钥一律经 .env 提供（deploy.yml 在 pm2 start 前 source .env），
    // 本文件禁止写入任何明文凭据 — 2026-09-08 曾因此泄露至公开 GitHub 仓库
    env: {
      NODE_OPTIONS: '--max-old-space-size=512',
      PORT: '3003',
      HOSTNAME: '0.0.0.0',
    },
  }]
};
