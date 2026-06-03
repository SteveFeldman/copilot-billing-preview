// SQL expressions that aggregate usage metrics, mirroring getUsageMetrics() in parser.ts.
// Alias names match UsageMetrics field names.
export const METRICS_SELECT = `
  SUM(CASE WHEN unit_type = 'requests' THEN quantity       ELSE 0 END)           AS requests,
  SUM(CASE WHEN unit_type = 'requests' THEN gross_amount   ELSE 0 END)           AS grossAmount,
  SUM(CASE WHEN unit_type = 'requests' THEN discount_amount ELSE 0 END)          AS discountAmount,
  SUM(CASE WHEN unit_type = 'requests' THEN net_amount     ELSE 0 END)           AS netAmount,
  SUM(CASE
    WHEN unit_type = 'requests' THEN aic_quantity
    ELSE CASE WHEN has_aic_quantity THEN aic_quantity ELSE quantity END
  END)                                                                            AS aicQuantity,
  SUM(aic_net_amount)                                                             AS aicGrossAmount,
  SUM(aic_net_amount)                                                             AS aicNetAmount
`.trim()
