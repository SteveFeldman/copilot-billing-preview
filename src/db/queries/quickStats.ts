import type * as duckdb from '@duckdb/duckdb-wasm'
import type { QuickStatsResult } from '../../pipeline/aggregators/quickStatsAggregator'
import type { ReportContextResult } from '../../pipeline/aggregators/reportContextAggregator'

export async function queryQuickStats(conn: duckdb.AsyncDuckDBConnection): Promise<QuickStatsResult> {
  const result = await conn.query(`
    SELECT
      COUNT(*)                                                                           AS lineCount,
      COUNT(DISTINCT CASE WHEN username != '' THEN username END)                        AS userCount,
      COUNT(DISTINCT CASE WHEN organization != '' THEN organization END)                AS orgCount,
      COUNT(DISTINCT CASE WHEN cost_center_name IS NOT NULL THEN cost_center_name END) AS costCenterCount
    FROM usage
  `)
  const row = result.toArray()[0].toJSON()
  return {
    lineCount: Number(row.lineCount),
    userCount: Number(row.userCount),
    orgCount: Number(row.orgCount),
    costCenterCount: Number(row.costCenterCount),
  }
}

/**
 * Extract distinct string values from an ARRAY_AGG column.
 *
 * DuckDB-WASM returns LIST columns as a proxy object whose Symbol.iterator
 * yields the list elements. `.toJSON()` on the row produces either a plain
 * Array or an iterable proxy depending on the Arrow version bundled with
 * duckdb-wasm. We handle both shapes defensively.
 */
function toStringArray(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value.filter((v) => v != null).map(String)
  }
  // Iterable proxy (Arrow Vector)
  if (typeof value === 'object' && Symbol.iterator in (value as object)) {
    const out: string[] = []
    for (const item of value as Iterable<unknown>) {
      if (item != null) out.push(String(item))
    }
    return out
  }
  return []
}

export async function queryReportContext(conn: duckdb.AsyncDuckDBConnection): Promise<ReportContextResult> {
  const result = await conn.query(`
    SELECT
      MIN(date)                     AS startDate,
      MAX(date)                     AS endDate,
      ARRAY_AGG(DISTINCT product)   AS products,
      ARRAY_AGG(DISTINCT sku)       AS skus,
      ARRAY_AGG(DISTINCT unit_type) AS unitTypes
    FROM usage
  `)
  const row = result.toArray()[0].toJSON()
  return {
    startDate: row.startDate != null ? String(row.startDate) : null,
    endDate: row.endDate != null ? String(row.endDate) : null,
    products: toStringArray(row.products),
    skus: toStringArray(row.skus),
    unitTypes: toStringArray(row.unitTypes),
  }
}
