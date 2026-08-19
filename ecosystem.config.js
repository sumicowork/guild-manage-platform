module.exports = {
  apps: [{
    name: 'guild-platform',
    cwd: '/opt/guild-manage-platform',
    script: '.next/standalone/server.js',
    exec_mode: 'fork',
    instances: 1,
    // 注意：不要加 max_memory_restart！Next 16 standalone 启动瞬间 RSS 峰值
    // 超 512M，PM2 每秒检测触发 SIGINT 杀进程 → 无限重启循环（已验证）
    env: {
      DATABASE_URL: 'postgresql://sumicowork:cKj46Xyw8tfT5znQ@127.0.0.1:5432/guild_platform?schema=public',
      JWT_SECRET: 'ef136c99b711ffac4f3cd18d0678131a32da52c5fecf850d97c6350fd9d27859',
      ENCRYPT_KEY: '5a3b8699103b02ee384b0f2792957a06ef6878a436addd80d79e60a6fb4c753b',
      GUILD_ID: '82203161765285899',
      NODE_OPTIONS: '--max-old-space-size=512',
      PORT: '3003',
      HOSTNAME: '0.0.0.0',
    },
  }]
};
