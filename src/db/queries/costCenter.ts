import type * as duckdb from '@duckdb/duckdb-wasm'
import type {
  CostCenterResult,
  CostCenterUsage,
  CostTotals,
  CostCenterUserTotals,
} from '../../pipeline/aggregators/costCenterAggregator'
import { METRICS_SELECT, USER_METRICS_SELECT } from './metrics'

function rowToTotals(r: Record<string, unknown>): CostTotals {
  return {
    requests: Number(r.requests),
    grossAmount: Number(r.grossAmount),
    discountAmount: Number(r.discountAmount),
    netAmount: Number(r.netAmount),
    aicQuantity: Number(r.aicQuantity),
    aicGrossAmount: Number(r.aicGrossAmount),
    aicNetAmount: Number(r.aicNetAmount),
  }
}

function rowToUserTotals(r: Record<string, unknown>): CostCenterUserTotals {
  return {
    requests: Number(r.requests),
    grossAmount: Number(r.grossAmount),
    netAmount: Number(r.netAmount),
    aicQuantity: Number(r.aicQuantity),
    aicGrossAmount: Number(r.aicGrossAmount),
    aicNetAmount: Number(r.aicNetAmount),
  }
}

export async function queryCostCenters(
  conn: duckdb.AsyncDuckDBConnection,
): Promise<CostCenterResult> {
  // Query 1: per cost-center totals + user count
  const totalsResult = await conn.query(`
    SELECT cost_center_name, COUNT(DISTINCT username) AS userCount, ${METRICS_SELECT}
    FROM usage
    WHERE cost_center_name IS NOT NULL
    GROUP BY cost_center_name
    ORDER BY cost_center_name ASC
  `)

  const costCenterMap = new Map<string, CostCenterUsage>()

  for (const row of totalsResult.toArray()) {
    const r = row.toJSON()
    const name = String(r.cost_center_name)
    const userCount = Number(r.userCount)
    const totals = rowToTotals(r)
    const netCostPerUser = userCount > 0 ? totals.netAmount / userCount : 0

    costCenterMap.set(name, {
      costCenterName: name,
      userCount,
      netCostPerUser,
      totals,
      totalsByModel: {},
      totalsByUser: {},
    })
  }

  // Query 2: per cost-center × model
  const modelResult = await conn.query(`
    SELECT cost_center_name, model_display_name, ${METRICS_SELECT}
    FROM usage
    WHERE cost_center_name IS NOT NULL
    GROUP BY cost_center_name, model_display_name
  `)

  for (const row of modelResult.toArray()) {
    const r = row.toJSON()
    const name = String(r.cost_center_name)
    const model = String(r.model_display_name)
    const entry = costCenterMap.get(name)
    if (entry) {
      entry.totalsByModel[model] = rowToTotals(r)
    }
  }

  // Query 3: per cost-center × user (6-field user totals, no discountAmount)
  const userResult = await conn.query(`
    SELECT cost_center_name, username, ${USER_METRICS_SELECT}
    FROM usage
    WHERE cost_center_name IS NOT NULL
    GROUP BY cost_center_name, username
  `)

  for (const row of userResult.toArray()) {
    const r = row.toJSON()
    const name = String(r.cost_center_name)
    const username = String(r.username)
    const entry = costCenterMap.get(name)
    if (entry) {
      entry.totalsByUser[username] = rowToUserTotals(r)
    }
  }

  return { costCenters: Array.from(costCenterMap.values()) }
}
