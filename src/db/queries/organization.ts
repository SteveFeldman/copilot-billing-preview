import type * as duckdb from '@duckdb/duckdb-wasm'
import type {
  OrganizationResult,
  OrganizationUsage,
  OrgTotals,
  OrgUserTotals,
} from '../../pipeline/aggregators/organizationAggregator'
import { METRICS_SELECT } from './metrics'

// 6-field user-breakdown fragment (no discountAmount)
const USER_METRICS_SELECT = `
  SUM(CASE WHEN unit_type = 'requests' THEN quantity       ELSE 0 END)           AS requests,
  SUM(CASE WHEN unit_type = 'requests' THEN gross_amount   ELSE 0 END)           AS grossAmount,
  SUM(CASE WHEN unit_type = 'requests' THEN net_amount     ELSE 0 END)           AS netAmount,
  SUM(CASE
    WHEN unit_type = 'requests' THEN aic_quantity
    ELSE CASE WHEN has_aic_quantity THEN aic_quantity ELSE quantity END
  END)                                                                            AS aicQuantity,
  SUM(CASE
    WHEN unit_type = 'requests' THEN aic_gross_amount
    ELSE CASE WHEN has_aic_gross_amount THEN aic_gross_amount ELSE gross_amount END
  END)                                                                            AS aicGrossAmount,
  SUM(aic_net_amount)                                                             AS aicNetAmount
`.trim()

function rowToTotals(r: Record<string, unknown>): OrgTotals {
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

function rowToUserTotals(r: Record<string, unknown>): OrgUserTotals {
  return {
    requests: Number(r.requests),
    grossAmount: Number(r.grossAmount),
    netAmount: Number(r.netAmount),
    aicQuantity: Number(r.aicQuantity),
    aicGrossAmount: Number(r.aicGrossAmount),
    aicNetAmount: Number(r.aicNetAmount),
  }
}

export async function queryOrganizationUsage(
  conn: duckdb.AsyncDuckDBConnection,
): Promise<OrganizationResult> {
  // Query 1: per organization totals + user count
  const totalsResult = await conn.query(`
    SELECT organization, COUNT(DISTINCT username) AS userCount, ${METRICS_SELECT}
    FROM usage
    GROUP BY organization
    ORDER BY organization ASC
  `)

  const orgMap = new Map<string, OrganizationUsage>()

  for (const row of totalsResult.toArray()) {
    const r = row.toJSON()
    const org = String(r.organization)
    const userCount = Number(r.userCount)

    orgMap.set(org, {
      organization: org,
      userCount,
      totals: rowToTotals(r),
      totalsByModel: {},
      totalsByUser: {},
    })
  }

  // Query 2: per organization × model
  const modelResult = await conn.query(`
    SELECT organization, model_display_name, ${METRICS_SELECT}
    FROM usage
    GROUP BY organization, model_display_name
  `)

  for (const row of modelResult.toArray()) {
    const r = row.toJSON()
    const org = String(r.organization)
    const model = String(r.model_display_name)
    const entry = orgMap.get(org)
    if (entry) {
      entry.totalsByModel[model] = rowToTotals(r)
    }
  }

  // Query 3: per organization × user (6-field user totals, no discountAmount)
  const userResult = await conn.query(`
    SELECT organization, username, ${USER_METRICS_SELECT}
    FROM usage
    GROUP BY organization, username
  `)

  for (const row of userResult.toArray()) {
    const r = row.toJSON()
    const org = String(r.organization)
    const username = String(r.username)
    const entry = orgMap.get(org)
    if (entry) {
      entry.totalsByUser[username] = rowToUserTotals(r)
    }
  }

  return { organizations: Array.from(orgMap.values()) }
}
