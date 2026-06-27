const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4173),
  publicDir: rootDir,
  storageDir: process.env.BEAM_STORAGE_DIR || path.join(rootDir, 'storage'),
  sessionSecret: process.env.SESSION_SECRET || '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:4173,http://localhost:4173')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  auth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
    appleClientId: process.env.APPLE_CLIENT_ID || '',
    appleTeamId: process.env.APPLE_TEAM_ID || '',
    appleKeyId: process.env.APPLE_KEY_ID || '',
    applePrivateKey: process.env.APPLE_PRIVATE_KEY || '',
    appleRedirectUri: process.env.APPLE_REDIRECT_URI || ''
  }
};

function requireProductionSecret() {
  if (config.env === 'production' && config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production.');
  }
}

module.exports = { config, requireProductionSecret };
