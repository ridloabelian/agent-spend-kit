import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { ensureSchema } from './migrate.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface DatabaseConnection {
  sqlite: Database.Database;
  db: AppDatabase;
  close: () => void;
}

export function createDatabase(dbPath = './data/agent-spend.db'): DatabaseConnection {
  if (dbPath !== ':memory:') {
    const resolvedDir = path.dirname(path.resolve(dbPath));
    fs.mkdirSync(resolvedDir, { recursive: true });
  }

  const sqlite = new Database(dbPath);

  if (dbPath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');

  ensureSchema(sqlite);

  const db = drizzle(sqlite, { schema });

  return {
    sqlite,
    db,
    close: () => {
      if (sqlite.open) {
        sqlite.close();
      }
    }
  };
}
