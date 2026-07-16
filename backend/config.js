const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4173),
  publicDir: rootDir,
  storageDir: process.env.BEAM_STORAGE_DIR || path.join(rootDir, 'storage'),
  cadFemDatabaseUrl: process.env.CAD_FEM_DATABASE_URL || process.env.DATABASE_URL || '',
  cadFemDatabaseHost: process.env.CAD_FEM_DATABASE_HOST || '',
  cadFemDatabasePort: Number(process.env.CAD_FEM_DATABASE_PORT || 5432),
  cadFemDatabaseName: process.env.CAD_FEM_DATABASE_NAME || 'beam_calculator',
  cadFemDatabaseUser: process.env.CAD_FEM_DATABASE_USER || 'cadfem',
  cadFemDatabasePassword: process.env.CAD_FEM_DATABASE_PASSWORD || '',
  cadFemDatabaseSsl: process.env.CAD_FEM_DATABASE_SSL !== 'false',
  cadFemDatabaseCaPath: process.env.CAD_FEM_DATABASE_CA_PATH || '',
  cadFemNativeBaseUrl: process.env.CAD_FEM_NATIVE_BASE_URL || '',
  cadFemNativeToken: process.env.CAD_FEM_NATIVE_TOKEN || '',
  cadFemGatewayToken: process.env.CAD_FEM_GATEWAY_TOKEN || '',
  cadFemAwsRegion: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-west-2',
  cadFemBatchJobQueue: process.env.CAD_FEM_BATCH_JOB_QUEUE || '',
  cadFemBatchJobDefinition: process.env.CAD_FEM_BATCH_JOB_DEFINITION || '',
  cadFemR2Endpoint: process.env.CAD_FEM_R2_ENDPOINT || '',
  cadFemR2Bucket: process.env.CAD_FEM_R2_BUCKET || '',
  cadFemR2AccessKeyId: process.env.CAD_FEM_R2_ACCESS_KEY_ID || '',
  cadFemR2SecretAccessKey: process.env.CAD_FEM_R2_SECRET_ACCESS_KEY || '',
  cadFemVerificationStepSha256: (process.env.CAD_FEM_VERIFICATION_STEP_SHA256 || '').toLowerCase(),
  sessionSecret: process.env.SESSION_SECRET || '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:8765,http://localhost:8765,https://bretwalda98.github.io')
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
  if (config.env === 'production' && config.allowedOrigins.some((origin) => origin === '*')) {
    throw new Error('Wildcard ALLOWED_ORIGINS is not permitted in production.');
  }
}

module.exports = { config, requireProductionSecret };
