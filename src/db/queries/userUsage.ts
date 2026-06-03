import type * as duckdb from '@duckdb/duckdb-wasm'
import type {
  UserUsage,
  UserUsageResult,
  UserDailyUsage,
  UserModelDailyUsage,
  UserProductUsage,
  UserProductBreakdown,
} from '../../pipeline/aggregators/userUsageAggregator'
import { classifyUserSpendSegments } from '../../utils/userSpendSegments'
import { METRICS_SELECT } from './metrics'

// SQL CASE expression mapping product/sku/model_display_name to a friendly name.
// Must match getFriendlyProductName() in src/pipeline/productClassification.ts.
const PRODUCT_EXPR = `CASE
  WHEN LOWER(TRIM(product)) = 'spark' OR LOWER(TRIM(sku)) = 'spark_premium_request'
    THEN 'Spark'
  WHEN LOWER(model_display_name) LIKE '%coding agent%' OR LOWER(model_display_name) LIKE '%padawan%'
    THEN 'Copilot Cloud Agent'
  ELSE 'Copilot'
END`

/**
 * Extract distinct non-null string values from an ARRAY_AGG column.
 *
 * DuckDB-WASM returns LIST columns as a proxy object whose Symbol.iterator
 * yields the list elements. `.toJSON()` on the row produces either a plain
 * Array or an iterable proxy depending on the Arrow version bundled with
 * duckdb-wasm. Both shapes are handled defensively.
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

function rowToMetrics(r: Record<string, unknown>) {
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

export async function queryUserUsage(
  conn: duckdb.AsyncDuckDBConnection,
): Promise<UserUsageResult> {
  // Q1: per-user totals + metadata
  const q1 = await conn.query(`
    SELECT
      username,
      MAX(total_monthly_quota)            AS maxQuota,
      COUNT(DISTINCT model_display_name)  AS distinctModels,
      ARRAY_AGG(DISTINCT organization)    AS organizations,
      ARRAY_AGG(DISTINCT cost_center_name) AS costCenters,
      ${METRICS_SELECT}
    FROM usage
    WHERE username IS NOT NULL AND username != ''
    GROUP BY username
  `)

  // Q2: per-user × date totals (no models yet)
  const q2 = await conn.query(`
    SELECT username, date, ${METRICS_SELECT}
    FROM usage
    WHERE username IS NOT NULL AND username != ''
    GROUP BY username, date
    ORDER BY username, date ASC
  `)

  // Q3: per-user × date × model (for daily.models)
  const q3 = await conn.query(`
    SELECT username, date, model_display_name, ${METRICS_SELECT}
    FROM usage
    WHERE username IS NOT NULL AND username != ''
    GROUP BY username, date, model_display_name
  `)

  // Q4: per-user × product × model (for products breakdown)
  const q4 = await conn.query(`
    SELECT
      username,
      ${PRODUCT_EXPR} AS product_name,
      model_display_name,
      ${METRICS_SELECT}
    FROM usage
    WHERE username IS NOT NULL AND username != ''
    GROUP BY username, product_name, model_display_name
  `)

  // Build user map from Q1
  const userMap = new Map<string, UserUsage>()

  for (const row of q1.toArray()) {
    const r = row.toJSON()
    const username = String(r.username)
    const metrics = rowToMetrics(r)

    // Filter out empty/null strings from ARRAY_AGG results
    const organizations = toStringArray(r.organizations).filter((s) => s.length > 0)
    const costCenters = toStringArray(r.costCenters).filter((s) => s.length > 0)

    userMap.set(username, {
      username,
      spendSegment: 'near-zero',
      totalMonthlyQuota: Number(r.maxQuota),
      organizations,
      costCenters,
      daily: {},
      products: {},
      totals: {
        ...metrics,
        distinctModels: Number(r.distinctModels),
      },
    })
  }

  // Populate daily date-level totals from Q2 (models starts empty, filled by Q3)
  for (const row of q2.toArray()) {
    const r = row.toJSON()
    const username = String(r.username)
    const date = String(r.date)
    const user = userMap.get(username)
    if (!user) continue

    const dayEntry: UserDailyUsage = {
      date,
      ...rowToMetrics(r),
      models: {},
    }
    user.daily[date] = dayEntry
  }

  // Populate daily.models from Q3
  for (const row of q3.toArray()) {
    const r = row.toJSON()
    const username = String(r.username)
    const date = String(r.date)
    const model = String(r.model_display_name)
    const user = userMap.get(username)
    if (!user) continue

    const day = user.daily[date]
    if (!day) continue

    const modelEntry: UserModelDailyUsage = rowToMetrics(r)
    day.models[model] = modelEntry
  }

  // Build products breakdown from Q4
  // First pass: collect per-product totals and per-model data
  const productTmpMap = new Map<string, Map<string, { productTotals: UserProductUsage; modelMap: Map<string, UserProductUsage> }>>()

  for (const row of q4.toArray()) {
    const r = row.toJSON()
    const username = String(r.username)
    const productName = String(r.product_name)
    const model = String(r.model_display_name)
    const user = userMap.get(username)
    if (!user) continue

    if (!productTmpMap.has(username)) {
      productTmpMap.set(username, new Map())
    }
    const userProducts = productTmpMap.get(username)!

    if (!userProducts.has(productName)) {
      userProducts.set(productName, {
        productTotals: { requests: 0, grossAmount: 0, discountAmount: 0, netAmount: 0, aicQuantity: 0, aicGrossAmount: 0, aicNetAmount: 0 },
        modelMap: new Map(),
      })
    }
    const productEntry = userProducts.get(productName)!
    const metrics = rowToMetrics(r)

    // Accumulate into product totals
    productEntry.productTotals.requests += metrics.requests
    productEntry.productTotals.grossAmount += metrics.grossAmount
    productEntry.productTotals.discountAmount += metrics.discountAmount
    productEntry.productTotals.netAmount += metrics.netAmount
    productEntry.productTotals.aicQuantity += metrics.aicQuantity
    productEntry.productTotals.aicGrossAmount += metrics.aicGrossAmount
    productEntry.productTotals.aicNetAmount += metrics.aicNetAmount

    // Store model-level data
    productEntry.modelMap.set(model, metrics)
  }

  // Transfer product data onto users
  for (const [username, userProducts] of productTmpMap.entries()) {
    const user = userMap.get(username)
    if (!user) continue

    for (const [productName, { productTotals, modelMap }] of userProducts.entries()) {
      const breakdown: UserProductBreakdown = {
        totals: productTotals,
        models: Object.fromEntries(modelMap.entries()),
      }
      user.products[productName] = breakdown
    }
  }

  // Classify spend segments
  const usersArray = Array.from(userMap.values())
  const segmentMap = classifyUserSpendSegments(usersArray)
  for (const user of usersArray) {
    user.spendSegment = segmentMap.get(user.username) ?? 'near-zero'
  }

  return { users: usersArray }
}
