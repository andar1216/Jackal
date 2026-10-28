const plaidEnv = (process.env.PLAID_ENV || 'sandbox').toLowerCase()

export const config = {
  port: Number(process.env.PORT) || 4000,
  // Only this computer by default. Set HOST=0.0.0.0 to accept connections from other machines.
  host: process.env.HOST || '127.0.0.1',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jackal',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  isProduction: process.env.NODE_ENV === 'production',
  // Set ALLOW_REGISTRATION=false to stop new sign-ups once your own account exists.
  allowRegistration: process.env.ALLOW_REGISTRATION !== 'false',

  // 32 random bytes, base64. Encrypts third-party access tokens stored in MongoDB.
  integrationKey: process.env.INTEGRATION_ENCRYPTION_KEY || '',

  plaid: {
    clientId: process.env.PLAID_CLIENT_ID || '',
    // Plaid gives a different secret per environment: use the one that matches PLAID_ENV.
    env: plaidEnv,
    secret:
      (plaidEnv === 'production' ? process.env.PLAID_PRODUCTION_SECRET : process.env.PLAID_SANDBOX_SECRET) ||
      process.env.PLAID_SECRET ||
      '',
    // Only needed for banks that sign in through their own app/site (OAuth) in production.
    redirectUri: process.env.PLAID_REDIRECT_URI || '',
  },
}
