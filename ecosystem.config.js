module.exports = {
  apps: [{
    name: 'guild-platform',
    cwd: '/opt/guild-manage-platform',
    script: '.next/standalone/server.js',
    exec_mode: 'fork',
    instances: 1,
    max_memory_restart: '512M',
    env: {
      NODE_OPTIONS: '--max-old-space-size=512',
      PORT: '3003',
      HOSTNAME: '0.0.0.0',
    },
  }]
};
