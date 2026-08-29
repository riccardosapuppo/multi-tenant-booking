import pg, { type PoolClient, type PoolConfig } from 'pg';

import type { SqlClient, SqlResult } from './sql-client.js';

const { Pool } = pg;

function postgresPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

export class PostgresSqlClient implements SqlClient {
  constructor(
    private readonly pool: pg.Pool | null,
    private readonly client: PoolClient | null = null,
  ) {}

  static connect(config: PoolConfig): PostgresSqlClient {
    return new PostgresSqlClient(new Pool(config));
  }

  async query<T>(sql: string, parameters: readonly unknown[] = []): Promise<SqlResult<T>> {
    const executor = this.client ?? this.pool;
    if (!executor) throw new Error('The PostgreSQL connection is closed.');
    const result = await executor.query(postgresPlaceholders(sql), [...parameters]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }

  async transaction<T>(operation: (client: SqlClient) => Promise<T>): Promise<T> {
    if (!this.pool || this.client) throw new Error('Nested transactions are not supported.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(new PostgresSqlClient(null, client));
      await client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}
