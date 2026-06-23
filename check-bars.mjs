import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: '35.223.155.186',
  database: 'axisandbloom',
  user: 'axisbloom',
  password: 'AxBloomApp2026#!',
  ssl: { rejectUnauthorized: false }
});

await client.connect();

const result = await client.query(`
  SELECT c.name,
         COUNT(DISTINCT sc.id)                                   AS session_count,
         COUNT(DISTINCT cs.id)                                   AS score_count,
         COUNT(DISTINCT CASE WHEN cs.is_merged THEN cs.id END)   AS merged_count,
         COUNT(DISTINCT csv.id)                                  AS value_count
  FROM coffees c
  LEFT JOIN session_coffees sc    ON sc.coffee_id = c.id
  LEFT JOIN cupping_scores cs     ON cs.session_coffee_id = sc.id
  LEFT JOIN cupping_score_values csv ON csv.cupping_score_id = cs.id
  GROUP BY c.id, c.name
  ORDER BY c.name
`);

console.table(result.rows);
await client.end();
