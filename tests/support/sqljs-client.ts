import path from 'node:path';

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

import type { SqlClient, SqlResult } from '../../apps/api/src/persistence/sql-client.js';

function sqliteParameter(value: unknown): string | number | Uint8Array | null {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Uint8Array) return value;
  if (value === null || value === undefined) return null;
  throw new Error(`Unsupported SQLite test parameter type: ${typeof value}.`);
}

export class SqlJsClient implements SqlClient {
  private inTransaction = false;

  constructor(private readonly database: Database) {}

  async query<T>(sql: string, parameters: readonly unknown[] = []): Promise<SqlResult<T>> {
    const statement = this.database.prepare(sql);
    const rows: T[] = [];
    try {
      statement.bind(parameters.map(sqliteParameter));
      while (statement.step()) rows.push(statement.getAsObject() as T);
    } finally {
      statement.free();
    }
    const readsRows = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);
    return { rows, rowCount: readsRows ? rows.length : this.database.getRowsModified() };
  }

  async transaction<T>(operation: (client: SqlClient) => Promise<T>): Promise<T> {
    if (this.inTransaction) throw new Error('Nested transactions are not supported.');
    this.inTransaction = true;
    this.database.run('BEGIN');
    try {
      const result = await operation(this);
      this.database.run('COMMIT');
      return result;
    } catch (error: unknown) {
      this.database.run('ROLLBACK');
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  async close(): Promise<void> {
    this.database.close();
  }
}

let sqlModule: Promise<SqlJsStatic> | undefined;

export function loadSqlJs(): Promise<SqlJsStatic> {
  sqlModule ??= initSqlJs({
    locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  });
  return sqlModule;
}
