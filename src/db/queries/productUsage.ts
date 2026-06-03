import type * as duckdb from '@duckdb/duckdb-wasm'
import type {
  ProductUsage,
  ProductUsageResult,
  ProductUsageTotals,
} from '../../pipeline/aggregators/productUsageAggregator'

// SQL CASE expression that maps raw product/sku/model_display_name to a friendly product name.
// Must match the logic in getFriendlyProductName() in src/pipeline/productClassification.ts.
const PRODUCT_EXPR = `CASE
  WHEN LOWER(TRIM(product)) = 'spark' OR LOWER(TRIM(sku)) = 'spark_premium_request'
    THEN 'Spark'
  WHEN LOWER(model_display_name) LIKE '%coding agent%' OR LOWER(model_display_name) LIKE '%padawan%'
    THEN 'Copilot Cloud Agent'
  ELSE 'Copilot'
END`

// Metric columns for ProductUsageTotals (no discountAmount).
const PRODUCT_METRICS_SELECT = `
  SUM(CASE WHEN unit_type = 'requests' THEN quantity       ELSE 0 END)           AS requests,
  SUM(CASE WHEN unit_type = 'requests' THEN gross_amount   ELSE 0 END)           AS grossAmount,
  SUM(CASE WHEN unit_type = 'requests' THEN net_amount     ELSE 0 END)           AS netAmount,
  SUM(CASE
    WHEN unit_type = 'requests' THEN aic_quantity
    ELSE CASE WHEN has_aic_quantity THEN aic_quantity ELSE quantity END
  END)                                                                            AS aicQuantity,
  SUM(aic_net_amount)                                                             AS aicGrossAmount,
  SUM(aic_net_amount)                                                             AS aicNetAmount
`.trim()

function rowToTotals(r: Record<string, unknown>): ProductUsageTotals {
  return {
    requests: Number(r.requests),
    grossAmount: Number(r.grossAmount),
    netAmount: Number(r.netAmount),
    aicQuantity: Number(r.aicQuantity),
    aicGrossAmount: Number(r.aicGrossAmount),
    aicNetAmount: Number(r.aicNetAmount),
  }
}

export async function queryProductUsage(
  conn: duckdb.AsyncDuckDBConnection,
): Promise<ProductUsageResult> {
  // Query 1: totals per product
  const totalsResult = await conn.query(`
    SELECT
      ${PRODUCT_EXPR} AS product_name,
      ${PRODUCT_METRICS_SELECT}
    FROM usage
    GROUP BY product_name
  `)

  const productMap = new Map<string, ProductUsage>()

  for (const row of totalsResult.toArray()) {
    const r = row.toJSON()
    const productName = String(r.product_name)
    productMap.set(productName, {
      product: productName,
      totals: rowToTotals(r),
      models: {},
    })
  }

  // Query 2: per-product per-model breakdown
  const modelResult = await conn.query(`
    SELECT
      ${PRODUCT_EXPR} AS product_name,
      model_display_name,
      ${PRODUCT_METRICS_SELECT}
    FROM usage
    GROUP BY product_name, model_display_name
  `)

  for (const row of modelResult.toArray()) {
    const r = row.toJSON()
    const productName = String(r.product_name)
    const modelName = String(r.model_display_name)

    const productEntry = productMap.get(productName)
    if (productEntry) {
      productEntry.models[modelName] = rowToTotals(r)
    }
  }

  return { products: Array.from(productMap.values()) }
}
