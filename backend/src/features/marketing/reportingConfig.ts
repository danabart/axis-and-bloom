import { db } from '../../db/client.js';

const KEYS = ['looker_studio_url', 'mailchimp_audience_url', 'adspend_sheet_url'] as const;
export type MarketingConfigKey = (typeof KEYS)[number];
const VALID_KEYS: ReadonlySet<string> = new Set(KEYS);

export type MarketingConfig = Record<MarketingConfigKey, string | null>;

/** Admin-editable marketing dashboard links (launch/20_analytics-and-tracking/06_B3). */
export async function getMarketingConfig(): Promise<MarketingConfig> {
  const result = await db.query<{ key: MarketingConfigKey; value: string | null }>(
    `SELECT key, value FROM marketing_config`,
  );
  const config = { looker_studio_url: null, mailchimp_audience_url: null, adspend_sheet_url: null } as MarketingConfig;
  for (const row of result.rows) config[row.key] = row.value;
  return config;
}

export async function setMarketingConfigValue(key: unknown, value: unknown): Promise<MarketingConfig> {
  if (typeof key !== 'string' || !VALID_KEYS.has(key)) {
    throw new Error(`key must be one of ${KEYS.join(', ')}`);
  }
  const nextValue = typeof value === 'string' && value.trim() ? value.trim() : null;

  await db.query(
    `UPDATE marketing_config SET value = $2, updated_at = timezone('utc', now()) WHERE key = $1`,
    [key, nextValue],
  );
  return getMarketingConfig();
}
