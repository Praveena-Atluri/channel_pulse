import { createClient, type Client, type InValue, type Row } from "@libsql/client/http";

type QueryResult<T = unknown> = {
  data: T | null;
  error: Error | null;
};

type Filter = {
  column: string;
  operator: "=" | ">=" | ">" | "<=" | "<";
  value: unknown;
};

type InFilter = {
  column: string;
  values: unknown[];
};

type OrderClause = {
  column: string;
  ascending: boolean;
};

type QueryMode = "select" | "insert" | "update" | "upsert" | "delete";

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const TRANSIENT_QUERY_ATTEMPTS = 3;

let cachedClient: Client | null = null;
let cachedClientKey = "";

export function createTursoAdminClient(url: string, authToken?: string) {
  return {
    from(table: string) {
      return new TursoQueryBuilder(getClient(url, authToken), table);
    }
  };
}

function getClient(url: string, authToken?: string) {
  const key = `${url}|${authToken ?? ""}`;
  if (!cachedClient || cachedClientKey !== key) {
    cachedClient = createClient({
      authToken,
      intMode: "number",
      url
    });
    cachedClientKey = key;
  }

  return cachedClient;
}

class TursoQueryBuilder implements PromiseLike<QueryResult> {
  private columns = "*";
  private mode: QueryMode = "select";
  private shouldReturnRows = false;
  private payload: Record<string, unknown> | Array<Record<string, unknown>> | null = null;
  private conflictColumns: string[] = [];
  private filters: Filter[] = [];
  private inFilters: InFilter[] = [];
  private orderClauses: OrderClause[] = [];
  private limitCount: number | null = null;
  private offsetCount: number | null = null;
  private resultMode: "many" | "single" | "maybeSingle" = "many";

  constructor(
    private readonly client: Client,
    private readonly table: string
  ) {
    assertIdentifier(table);
  }

  select(columns = "*") {
    this.columns = columns;
    this.shouldReturnRows = true;
    return this;
  }

  insert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  upsert(payload: Array<Record<string, unknown>>, options: { onConflict: string }) {
    this.mode = "upsert";
    this.payload = payload;
    this.conflictColumns = options.onConflict.split(",").map((column) => normalizeIdentifier(column.trim()));
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column: normalizeIdentifier(column), operator: "=", value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ column: normalizeIdentifier(column), operator: ">=", value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ column: normalizeIdentifier(column), operator: ">", value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ column: normalizeIdentifier(column), operator: "<=", value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ column: normalizeIdentifier(column), operator: "<", value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.inFilters.push({ column: normalizeIdentifier(column), values });
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.orderClauses.push({ column: normalizeIdentifier(column), ascending: options.ascending !== false });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number) {
    this.offsetCount = from;
    this.limitCount = Math.max(0, to - from + 1);
    return this;
  }

  single() {
    this.resultMode = "single";
    return this.execute();
  }

  maybeSingle() {
    this.resultMode = "maybeSingle";
    return this.execute();
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult> {
    try {
      let rows: Row[];
      if (this.mode === "insert") {
        rows = await this.executeInsert();
      } else if (this.mode === "update") {
        rows = await this.executeUpdate();
      } else if (this.mode === "upsert") {
        rows = await this.executeUpsert();
      } else if (this.mode === "delete") {
        rows = await this.executeDelete();
      } else {
        rows = await this.executeSelect();
      }

      return { data: this.formatRows(rows), error: null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  private async executeSelect() {
    const { sql, args } = this.buildSelectQuery();
    const result = await executeWithTransientRetry(() => this.client.execute({ sql, args }));
    return result.rows;
  }

  private async executeInsert() {
    const rows = normalizeRows(this.payload);
    if (rows.length === 0) return [];

    const columns = getPayloadColumns(rows);
    const args: InValue[] = [];
    const valuesSql = buildValuesSql(rows, columns, args);
    const returning = this.shouldReturnRows ? ` returning ${buildSelectList(this.columns)}` : "";
    const result = await executeWithTransientRetry(() => this.client.execute({
      args,
      sql: `insert into ${quoteIdentifier(this.table)} (${columns.map(quoteIdentifier).join(", ")}) values ${valuesSql}${returning}`
    }));

    return result.rows;
  }

  private async executeUpdate() {
    const rows = normalizeRows(this.payload);
    const row = rows[0];
    if (!row) return [];

    const columns = Object.keys(row).map(normalizeIdentifier);
    const args: InValue[] = [];
    const assignments = columns.map((column) => `${quoteIdentifier(column)} = ?`);
    for (const column of columns) {
      args.push(normalizeParam(row[column]));
    }

    const where = this.buildWhereClause(args);
    const returning = this.shouldReturnRows ? ` returning ${buildSelectList(this.columns)}` : "";
    const result = await executeWithTransientRetry(() => this.client.execute({
      args,
      sql: `update ${quoteIdentifier(this.table)} set ${assignments.join(", ")}${where}${returning}`
    }));

    return result.rows;
  }

  private async executeUpsert() {
    const rows = normalizeRows(this.payload);
    if (rows.length === 0) return [];
    if (this.conflictColumns.length === 0) {
      throw new Error("Missing upsert conflict columns.");
    }

    const columns = getPayloadColumns(rows);
    const args: InValue[] = [];
    const valuesSql = buildValuesSql(rows, columns, args);
    const updateColumns = columns.filter((column) => !this.conflictColumns.includes(column));
    const conflictSql = this.conflictColumns.map(quoteIdentifier).join(", ");
    const updateSql =
      updateColumns.length > 0
        ? `do update set ${updateColumns
            .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
            .join(", ")}`
        : "do nothing";
    const returning = this.shouldReturnRows ? ` returning ${buildSelectList(this.columns)}` : "";
    const result = await executeWithTransientRetry(() => this.client.execute({
      args,
      sql: `insert into ${quoteIdentifier(this.table)} (${columns
        .map(quoteIdentifier)
        .join(", ")}) values ${valuesSql} on conflict (${conflictSql}) ${updateSql}${returning}`
    }));

    return result.rows;
  }

  private async executeDelete() {
    const args: InValue[] = [];
    const where = this.buildWhereClause(args);
    if (!where) {
      throw new Error("Refusing to delete without filters.");
    }

    const returning = this.shouldReturnRows ? ` returning ${buildSelectList(this.columns)}` : "";
    const result = await executeWithTransientRetry(() =>
      this.client.execute({
        args,
        sql: `delete from ${quoteIdentifier(this.table)}${where}${returning}`
      })
    );

    return result.rows;
  }

  private buildSelectQuery() {
    const args: InValue[] = [];
    const where = this.buildWhereClause(args);
    const orderBy =
      this.orderClauses.length > 0
        ? ` order by ${this.orderClauses
            .map((clause) => `${quoteIdentifier(clause.column)} ${clause.ascending ? "asc" : "desc"}`)
            .join(", ")}`
        : "";
    const limit = this.limitCount === null ? "" : ` limit ${this.limitCount}`;
    const offset = this.offsetCount === null ? "" : ` offset ${this.offsetCount}`;

    return {
      args,
      sql: `select ${buildSelectList(this.columns)} from ${quoteIdentifier(this.table)}${where}${orderBy}${limit}${offset}`
    };
  }

  private buildWhereClause(args: InValue[]) {
    const clauses: string[] = [];
    for (const filter of this.filters) {
      clauses.push(`${quoteIdentifier(filter.column)} ${filter.operator} ?`);
      args.push(normalizeParam(filter.value));
    }

    for (const filter of this.inFilters) {
      if (filter.values.length === 0) {
        clauses.push("0 = 1");
      } else {
        clauses.push(`${quoteIdentifier(filter.column)} in (${filter.values.map(() => "?").join(", ")})`);
        args.push(...filter.values.map(normalizeParam));
      }
    }

    return clauses.length > 0 ? ` where ${clauses.join(" and ")}` : "";
  }

  private formatRows(rows: Row[]) {
    if (this.mode !== "select" && !this.shouldReturnRows) return null;

    const plainRows = rows.map(rowToObject);
    if (this.resultMode === "single") {
      if (plainRows.length !== 1) {
        throw new Error(`Expected exactly one row, received ${plainRows.length}.`);
      }

      return plainRows[0] ?? null;
    }

    if (this.resultMode === "maybeSingle") {
      if (plainRows.length > 1) {
        throw new Error(`Expected zero or one row, received ${plainRows.length}.`);
      }

      return plainRows[0] ?? null;
    }

    return plainRows;
  }
}

async function executeWithTransientRetry<T>(callback: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= TRANSIENT_QUERY_ATTEMPTS; attempt += 1) {
    try {
      return await callback();
    } catch (error) {
      lastError = error;
      if (attempt === TRANSIENT_QUERY_ATTEMPTS || !isTransientQueryError(error)) {
        throw error;
      }

      await sleep(150 * attempt * attempt);
    }
  }

  throw lastError;
}

function isTransientQueryError(error: unknown) {
  const messages = getErrorMessages(error).join(" ").toLowerCase();
  const codes = getErrorCodes(error);

  return (
    messages.includes("fetch failed") ||
    messages.includes("other side closed") ||
    codes.some((code) =>
      ["ECONNRESET", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code)
    )
  );
}

function getErrorMessages(error: unknown): string[] {
  if (!(error instanceof Error)) return [String(error)];
  return [error.message, ...getErrorMessages(error.cause)].filter(Boolean);
}

function getErrorCodes(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];

  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  return [code, ...getErrorCodes(cause)].filter(Boolean);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeRows(payload: Record<string, unknown> | Array<Record<string, unknown>> | null) {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : [payload];
}

function getPayloadColumns(rows: Array<Record<string, unknown>>) {
  const columns = Object.keys(rows[0] ?? {}).map(normalizeIdentifier);
  if (columns.length === 0) {
    throw new Error("Cannot write rows with no columns.");
  }

  return columns;
}

function buildValuesSql(rows: Array<Record<string, unknown>>, columns: string[], args: InValue[]) {
  return rows
    .map((row) => `(${columns.map((column) => {
      args.push(normalizeParam(row[column]));
      return "?";
    }).join(", ")})`)
    .join(", ");
}

function normalizeParam(value: unknown): InValue {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string" || value === null || value instanceof ArrayBuffer) {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  if (isPlainObject(value) || Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

function isPlainObject(value: unknown) {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function rowToObject(row: Row) {
  const object: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (/^\d+$/.test(key) || key === "length") continue;
    object[key] = typeof value === "bigint" ? Number(value) : value;
  }
  return object;
}

function buildSelectList(columns: string) {
  if (columns.trim() === "*") return "*";
  return columns
    .split(",")
    .map((column) => quoteIdentifier(normalizeIdentifier(column.trim())))
    .join(", ");
}

function normalizeIdentifier(identifier: string) {
  assertIdentifier(identifier);
  return identifier;
}

function assertIdentifier(identifier: string) {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
}

function quoteIdentifier(identifier: string) {
  assertIdentifier(identifier);
  return `"${identifier}"`;
}
