const { randomUUID } = require('crypto');
const { config } = require('../config');

function providers() {
  return {
    google: {
      configured: Boolean(config.auth.googleClientId && config.auth.googleClientSecret && config.auth.googleRedirectUri),
      required: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']
    },
    apple: {
      configured: Boolean(config.auth.appleClientId && config.auth.appleTeamId && config.auth.appleKeyId && config.auth.applePrivateKey && config.auth.appleRedirectUri),
      required: ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_REDIRECT_URI']
    },
    email: {
      configured: false,
      required: ['SMTP_HOST or transactional-email provider config', 'EMAIL_FROM', 'EMAIL_TOKEN_SECRET']
    }
  };
}

function notConfigured(provider) {
  const meta = providers()[provider];
  const err = new Error(`${provider} sign-in is not configured. Provide: ${meta.required.join(', ')}.`);
  err.statusCode = 501;
  err.code = 'auth_provider_not_configured';
  return err;
}

function oauthStart(provider) {
  const meta = providers()[provider];
  if (!meta?.configured) throw notConfigured(provider);
  // OAuth URL creation is intentionally left server-side. Do not expose client secrets to the browser.
  throw Object.assign(new Error(`${provider} OAuth callback flow requires production domain configuration before enabling.`), {
    statusCode: 501,
    code: 'oauth_flow_not_enabled'
  });
}

function unauthenticatedSession() {
  return {
    authenticated: false,
    user: null,
    providers: providers(),
    requestId: randomUUID()
  };
}

module.exports = { providers, oauthStart, unauthenticatedSession };
