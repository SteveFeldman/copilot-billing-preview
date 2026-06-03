export const USAGE_TABLE = 'usage'

export const CREATE_USAGE_TABLE_SQL = `
CREATE OR REPLACE TABLE ${USAGE_TABLE} (
  date                      VARCHAR NOT NULL,
  username                  VARCHAR NOT NULL,
  product                   VARCHAR NOT NULL,
  sku                       VARCHAR NOT NULL,
  model_display_name        VARCHAR NOT NULL,
  quantity                  DOUBLE  NOT NULL,
  unit_type                 VARCHAR NOT NULL,
  applied_cost_per_quantity DOUBLE  NOT NULL,
  gross_amount              DOUBLE  NOT NULL,
  discount_amount           DOUBLE  NOT NULL,
  net_amount                DOUBLE  NOT NULL,
  exceeds_quota             BOOLEAN NOT NULL,
  total_monthly_quota       DOUBLE  NOT NULL,
  organization              VARCHAR NOT NULL,
  cost_center_name          VARCHAR,
  aic_quantity              DOUBLE  NOT NULL,
  aic_gross_amount          DOUBLE  NOT NULL,
  aic_net_amount            DOUBLE  NOT NULL,
  has_aic_quantity          BOOLEAN NOT NULL,
  has_aic_gross_amount      BOOLEAN NOT NULL
)
`
