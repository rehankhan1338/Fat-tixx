import 'server-only';
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { env } from './env';

declare global {
  // Reuse the pool across hot reloads in development.
  var __fattixxPool: Pool | undefined;
}

function createPool(): Pool {
  return mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
}

export const db: Pool = globalThis.__fattixxPool ?? (globalThis.__fattixxPool = createPool());

export type Row = RowDataPacket;
/** Values are always passed as placeholders and escaped by mysql2; never interpolate into SQL. */
export type SqlParam = string | number | bigint | boolean | null | Buffer | Date;

/** SELECT helper returning typed rows. */
export async function query<T extends Row = Row>(sql: string, params: SqlParam[] = []): Promise<T[]> {
  const [rows] = await db.query<T[]>(sql, params);
  return rows;
}

/** SELECT helper returning the first row or null. */
export async function queryOne<T extends Row = Row>(sql: string, params: SqlParam[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** INSERT/UPDATE/DELETE helper. */
export async function execute(sql: string, params: SqlParam[] = []): Promise<ResultSetHeader> {
  const [result] = await db.query<ResultSetHeader>(sql, params);
  return result;
}
