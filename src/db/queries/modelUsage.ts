import type * as duckdb from '@duckdb/duckdb-wasm'
import type {
  ModelDailyUsageData,
  ModelUsageResult,
  ModelUsageTotals,
} from '../../pipeline/aggregators/modelUsageAggregator'
import { METRICS_SELECT } from './metrics'

function zeroTotals(): ModelUsageTotals {
  return {
    requests: 0,
    aicQuantity: 0,
    grossAmount: 0,
    aicGrossAmount: 0,
    aicNetAmount: 0,
    discountAmount: 0,
    netAmount: 0,
  }
}

export async function queryModelUsage(
  conn: duckdb.AsyncDuckDBConnection,
): Promise<ModelUsageResult> {
  const result = await conn.query(`
    SELECT model_display_name, date, ${METRICS_SELECT}
    FROM usage
    WHERE date IS NOT NULL AND date != ''
    GROUP BY model_display_name, date
    ORDER BY model_display_name, date ASC
  `)

  const byModel: Record<string, ModelDailyUsageData[]> = {}
  const totalsByModel: Record<string, ModelUsageTotals> = {}

  for (const row of result.toArray()) {
    const r = row.toJSON()
    const model = String(r.model_display_name)

    const day: ModelDailyUsageData = {
      date: String(r.date),
      requests: Number(r.requests),
      grossAmount: Number(r.grossAmount),
      discountAmount: Number(r.discountAmount),
      netAmount: Number(r.netAmount),
      aicQuantity: Number(r.aicQuantity),
      aicGrossAmount: Number(r.aicGrossAmount),
      aicNetAmount: Number(r.aicNetAmount),
    }

    if (!byModel[model]) {
      byModel[model] = []
      totalsByModel[model] = zeroTotals()
    }

    byModel[model].push(day)

    const totals = totalsByModel[model]
    totals.requests += day.requests
    totals.aicQuantity += day.aicQuantity
    totals.grossAmount += day.grossAmount
    totals.aicGrossAmount += day.aicGrossAmount
    totals.aicNetAmount += day.aicNetAmount
    totals.discountAmount += day.discountAmount
    totals.netAmount += day.netAmount
  }

  return { models: Object.keys(byModel), byModel, totalsByModel }
}
