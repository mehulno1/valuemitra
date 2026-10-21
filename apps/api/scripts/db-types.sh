#!/bin/sh
# Regenerate src/db/types.ts from the live schema. DECIMAL columns are returned as numbers
# (mysql2 decimalNumbers) and generated firm_key columns are read-only.
set -e
cd "$(dirname "$0")/.."
set -a; . ../../.env; set +a
DATABASE_URL="mysql://$DB_USER:$(node -e "process.stdout.write(encodeURIComponent(process.env.DB_PASSWORD))")@$DB_HOST:$DB_PORT/$DB_NAME" \
  npx kysely-codegen --dialect mysql --out-file src/db/types.ts --exclude-pattern schema_migrations
sed -i.bak -e 's/export type Decimal = ColumnType<string, number | string>;/export type Decimal = ColumnType<number, number | string>;/' \
  -e 's/^  firm_key: .*$/  firm_key: ColumnType<number, never, never>;/' src/db/types.ts && rm src/db/types.ts.bak
