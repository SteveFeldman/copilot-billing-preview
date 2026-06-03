import type * as duckdb from '@duckdb/duckdb-wasm'
import type { DailyUsageResult } from '../../pipeline/aggregators/dailyUsageAggregator'
import { METRICS_SELECT } from './metrics'

export async function queryDailyUsage(
  conn: duckdb.AsyncDuckDBConnection,
): Promise<DailyUsageResult> {
  const result = await conn.query(`
    SELECT date, ${METRICS_SELECT}
    FROM usage
    WHERE date IS NOT NULL AND date != ''
    GROUP BY date
    ORDER BY date ASC
  `)

  const dailyData = result.toArray().map((row) => {
    const r = row.toJSON()
    return {
      date: String(r.date),
      requests: Number(r.requests),
      grossAmount: Number(r.grossAmount),
      discountAmount: Number(r.discountAmount),
      netAmount: Number(r.netAmount),
      aicQuantity: Number(r.aicQuantity),
      aicGrossAmount: Number(r.aicGrossAmount),
      aicNetAmount: Number(r.aicNetAmount),
    }
  })

  return { dailyData }
}
