import {
  vectorFromArray,
  tableToIPC,
  RecordBatch,
  Table,
  Utf8,
  Float64,
  Bool,
} from 'apache-arrow'
import * as duckdb from '@duckdb/duckdb-wasm'
import type { TokenUsageRecord } from '../pipeline/parser'
import { getDisplayModelName } from '../pipeline/modelLabels'
import { CREATE_USAGE_TABLE_SQL, USAGE_TABLE } from './schema'

// ---------------------------------------------------------------------------
// RowAppender — columnar row accumulator that flushes via Arrow IPC stream
// ---------------------------------------------------------------------------
// DuckDB-WASM's async API does not expose a native Appender. This class
// mirrors a synchronous Appender interface (appendVarchar, appendDouble,
// appendBool, appendNull, endRow, flush, close) but buffers writes locally
// and materialises them as an Apache Arrow IPC stream on flush().
//
// Arrow IPC stream format is the lowest-level insertion path supported by
// AsyncDuckDBConnection and avoids type-inference issues that arise when
// using insertArrowTable (which silently drops rows in some DuckDB-WASM
// builds). insertArrowFromIPCStream is the reliable path.
// ---------------------------------------------------------------------------

type ColType = 'varchar' | 'double' | 'bool'

interface ColDef {
  name: string
  type: ColType
  values: (string | number | boolean | null)[]
}

export class RowAppender {
  private readonly _conn: duckdb.AsyncDuckDBConnection
  private readonly _table: string
  private readonly _schema: string
  private _cols: ColDef[] = []
  private _cursor = 0

  constructor(
    conn: duckdb.AsyncDuckDBConnection,
    schema: string,
    table: string,
  ) {
    this._conn = conn
    this._schema = schema
    this._table = table
  }

  // ---- column registration ----

  setColumnDefs(defs: { name: string; type: ColType }[]): void {
    if (this._cols.length === 0) {
      this._cols = defs.map((d) => ({ ...d, values: [] }))
    }
  }

  // ---- append helpers (positional, must match setColumnDefs order) ----

  appendVarchar(value: string): void {
    this._cols[this._cursor].values.push(value)
    this._cursor++
  }

  appendDouble(value: number): void {
    this._cols[this._cursor].values.push(value)
    this._cursor++
  }

  appendBool(value: boolean): void {
    this._cols[this._cursor].values.push(value)
    this._cursor++
  }

  appendNull(): void {
    this._cols[this._cursor].values.push(null)
    this._cursor++
  }

  endRow(): void {
    this._cursor = 0
  }

  // ---- flush: materialise all buffered rows as Arrow IPC and INSERT ----

  async flush(): Promise<void> {
    if (this._cols.length === 0 || this._cols[0].values.length === 0) {
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const colData: Record<string, any> = {}
    for (const col of this._cols) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let vec: import('apache-arrow').Vector<any>
      switch (col.type) {
        case 'varchar':
          vec = vectorFromArray(col.values as (string | null)[], new Utf8())
          break
        case 'double':
          vec = vectorFromArray(col.values as (number | null)[], new Float64())
          break
        case 'bool':
          vec = vectorFromArray(col.values as (boolean | null)[], new Bool())
          break
        default: {
          const _exhaustive: never = col.type
          throw new Error(`RowAppender: unhandled column type: ${_exhaustive}`)
        }
      }
      colData[col.name] = vec.data[0]
    }

    const batch = new RecordBatch(colData)
    const table = new Table([batch])
    const ipc = tableToIPC(table, 'stream')

    await this._conn.insertArrowFromIPCStream(ipc, {
      name: this._table,
      schema: this._schema || undefined,
      create: false,
    })

    // Reset value buffers after successful flush
    for (const col of this._cols) {
      col.values = []
    }
  }

  async close(): Promise<void> {
    await this.flush()
  }
}

// ---------------------------------------------------------------------------
// Augment AsyncDuckDBConnection with createAppender
// ---------------------------------------------------------------------------

declare module '@duckdb/duckdb-wasm' {
  interface AsyncDuckDBConnection {
    createAppender(schema: string, table: string): Promise<RowAppender>
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const connProto = duckdb.AsyncDuckDBConnection.prototype as any
if (!connProto.createAppender) {
  connProto.createAppender = function (
    this: duckdb.AsyncDuckDBConnection,
    schema: string,
    table: string,
  ): Promise<RowAppender> {
    return Promise.resolve(new RowAppender(this, schema, table))
  }
}

// ---------------------------------------------------------------------------
// Column definitions in exactly the same order as CREATE_USAGE_TABLE_SQL
// ---------------------------------------------------------------------------

const USAGE_COL_DEFS: { name: string; type: ColType }[] = [
  { name: 'date', type: 'varchar' },
  { name: 'username', type: 'varchar' },
  { name: 'product', type: 'varchar' },
  { name: 'sku', type: 'varchar' },
  { name: 'model_display_name', type: 'varchar' },
  { name: 'quantity', type: 'double' },
  { name: 'unit_type', type: 'varchar' },
  { name: 'applied_cost_per_quantity', type: 'double' },
  { name: 'gross_amount', type: 'double' },
  { name: 'discount_amount', type: 'double' },
  { name: 'net_amount', type: 'double' },
  { name: 'exceeds_quota', type: 'bool' },
  { name: 'total_monthly_quota', type: 'double' },
  { name: 'organization', type: 'varchar' },
  { name: 'cost_center_name', type: 'varchar' },
  { name: 'aic_quantity', type: 'double' },
  { name: 'aic_gross_amount', type: 'double' },
  { name: 'aic_net_amount', type: 'double' },
  { name: 'has_aic_quantity', type: 'bool' },
  { name: 'has_aic_gross_amount', type: 'bool' },
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createUsageTable(
  conn: duckdb.AsyncDuckDBConnection,
): Promise<void> {
  await conn.query(CREATE_USAGE_TABLE_SQL)
}

/**
 * Append a single TokenUsageRecord to the RowAppender.
 *
 * Column order must exactly match CREATE_USAGE_TABLE_SQL and USAGE_COL_DEFS.
 */
export function appendRow(
  appender: RowAppender,
  record: TokenUsageRecord,
): void {
  // Register column definitions on first call (idempotent)
  appender.setColumnDefs(USAGE_COL_DEFS)

  appender.appendVarchar(record.date)
  appender.appendVarchar(record.username)
  appender.appendVarchar(record.product)
  appender.appendVarchar(record.sku)
  appender.appendVarchar(getDisplayModelName(record.model))
  appender.appendDouble(record.quantity)
  appender.appendVarchar(record.unit_type)
  appender.appendDouble(record.applied_cost_per_quantity)
  appender.appendDouble(record.gross_amount)
  appender.appendDouble(record.discount_amount)
  appender.appendDouble(record.net_amount)
  appender.appendBool(record.exceeds_quota)
  appender.appendDouble(record.total_monthly_quota)
  appender.appendVarchar(record.organization)
  if (record.cost_center_name !== null) {
    appender.appendVarchar(record.cost_center_name)
  } else {
    appender.appendNull()
  }
  appender.appendDouble(record.aic_quantity)
  appender.appendDouble(record.aic_gross_amount)
  appender.appendDouble(record.aic_net_amount)
  appender.appendBool(record.has_aic_quantity)
  appender.appendBool(record.has_aic_gross_amount)
  appender.endRow()
}

// Re-export for callers that need the table name
export { USAGE_TABLE }
