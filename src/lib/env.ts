import 'server-only';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. Run \`npm run db:setup\` to generate .env.local.`);
  return v;
}

export const env = {
  get DB_HOST() { return process.env.DB_HOST ?? '127.0.0.1'; },
  get DB_PORT() { return Number(process.env.DB_PORT ?? 3307); },
  get DB_NAME() { return process.env.DB_NAME ?? 'fattixx'; },
  get DB_USER() { return required('DB_USER'); },
  get DB_PASSWORD() { return required('DB_PASSWORD'); },
  /** 32-byte hex key used for AES-256-GCM encryption of secrets stored in the database (Stripe keys). */
  get APP_ENCRYPTION_KEY(): Buffer {
    const hex = required('APP_ENCRYPTION_KEY');
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
    return Buffer.from(hex, 'hex');
  },
  get APP_URL() { return process.env.APP_URL ?? 'http://localhost:3000'; },
  /** Only trust X-Forwarded-For when explicitly behind a reverse proxy you control. */
  get TRUST_PROXY() { return process.env.TRUST_PROXY === 'true'; },
  get IS_PROD() { return process.env.NODE_ENV === 'production'; },
};
