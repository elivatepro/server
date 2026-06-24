import Database from 'better-sqlite3'
import * as fs from 'node:fs'

interface DatabaseSchema {
  users: {
    id: number;
    uid: string;
    created: string;
  };
  files: {
    id: number;
    users_id: number;
    filename: string;
    filetype: string;
    bytes: number | null;
    encrypted: number | null;
    hash: string | null;
    remote_id: string | null;
    created: string;
    updated: string;
    expires: string | null;
  };
  apiKeys: {
    id: number;
    user_id: number;
    api_key: string;
    created: string;
    validated: string | null;
    revoked: string | null;
  };
  cf_daily: {
    date: number;
    requests: number;
    bytes: number;
    cached_requests: number;
    cached_bytes: number;
    page_views: number;
    threats: number;
    uniques: number;
  };
  cf_country_daily: {
    date: number;
    country: string;
    requests: number;
  };
}

export function now () {
  return dateToSqlite(new Date())
}

export function dateToSqlite (date: Date) {
  return Math.floor(date.getTime() / 1000)
}

export function epochToDate (sqliteDate: number) {
  return new Date(sqliteDate * 1000)
}

export type TableRow<T extends keyof DatabaseSchema> = DatabaseSchema[T]
const db = new Database('../db/database.db')
db.pragma('journal_mode = WAL')

// Set up the tables
const migration = fs.readFileSync('schema.sql', 'utf8')
db.exec(migration)

// One-shot backfill of `shares_daily` from existing notes so the historical
// chart isn't empty on launch. Only runs if the table is empty.
if (!db.prepare('SELECT 1 FROM shares_daily LIMIT 1').get()) {
  db.exec(`
    INSERT INTO shares_daily (date, new_notes)
    SELECT unixepoch(date(created, 'unixepoch')) AS day, COUNT(*)
    FROM files
    WHERE filetype = 'html'
    GROUP BY day
    ON CONFLICT(date) DO NOTHING
  `)
}

export type { Database as SQLite } from 'better-sqlite3'
export default db
