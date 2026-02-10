declare module 'lbug' {
  export type KuzuValue
    = | null
      | boolean
      | number
      | bigint
      | string
      | Date
      | KuzuValue[]
      | { [key: string]: KuzuValue }

  export class Database {
    constructor(
      databasePath?: string,
      bufferManagerSize?: number,
      enableCompression?: boolean,
      readOnly?: boolean,
      maxDBSize?: number,
    )
    init(): Promise<void>
    close(): Promise<void>
    static getVersion(): string
    static getStorageVersion(): number
  }

  export class Connection {
    constructor(database: Database, numThreads?: number)
    init(): Promise<void>
    close(): Promise<void>
    execute(
      preparedStatement: PreparedStatement,
      params?: Record<string, KuzuValue>,
    ): Promise<QueryResult>
    prepare(statement: string): Promise<PreparedStatement>
    query(statement: string): Promise<QueryResult>
    setMaxNumThreadForExec(numThreads: number): void
    setQueryTimeout(timeoutInMs: number): void
  }

  export class PreparedStatement {
    isSuccess(): boolean
    getErrorMessage(): string
  }

  export class QueryResult {
    resetIterator(): void
    hasNext(): boolean
    getNumTuples(): number
    getNext(): Promise<Record<string, KuzuValue> | null>
    getAll(): Promise<Record<string, KuzuValue>[]>
    getColumnDataTypes(): Promise<string[]>
    getColumnNames(): Promise<string[]>
    close(): void
  }

  const lbug: {
    Database: typeof Database
    Connection: typeof Connection
    PreparedStatement: typeof PreparedStatement
    QueryResult: typeof QueryResult
    VERSION: string
    STORAGE_VERSION: bigint
  }
  export default lbug
}
