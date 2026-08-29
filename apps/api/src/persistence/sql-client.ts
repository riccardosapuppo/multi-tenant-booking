export interface SqlResult<T> {
  rows: T[];
  rowCount: number;
}

export interface SqlClient {
  query<T>(sql: string, parameters?: readonly unknown[]): Promise<SqlResult<T>>;
  transaction<T>(operation: (client: SqlClient) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

export type SqlClientFactory = (databaseName: string) => Promise<SqlClient>;
