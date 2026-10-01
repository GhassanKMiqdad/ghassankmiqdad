#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Runs the pgTAP database suite against a throw-away local PostgreSQL server,
# without Docker or the Supabase CLI.
#
# Requirements: PostgreSQL 15+ server binaries (initdb, pg_ctl), pgTAP and
# pg_prove. On Debian/Ubuntu:
#   sudo apt-get install postgresql postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl
#
# The official way remains `npx supabase test db` against the Supabase local
# stack; this script uses scripts/sql/supabase-shim.sql to emulate the
# few Supabase objects (auth/storage schemas, roles) the migrations depend on.
# -----------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)}"
PORT="${PGTEST_PORT:-54329}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rtp-pgtest.XXXXXX")"
RUN_AS=()

# initdb refuses to run as root; fall back to the postgres OS user.
if [[ "$(id -u)" == "0" ]]; then
  chown postgres:postgres "$WORK_DIR"
  RUN_AS=(su postgres -s /bin/bash -c)
fi

run_pg() {
  if [[ ${#RUN_AS[@]} -gt 0 ]]; then
    "${RUN_AS[@]}" "$*"
  else
    bash -c "$*"
  fi
}

cleanup() {
  run_pg "\"$PG_BIN/pg_ctl\" -D \"$WORK_DIR/data\" -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

run_pg "\"$PG_BIN/initdb\" -D \"$WORK_DIR/data\" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
run_pg "\"$PG_BIN/pg_ctl\" -D \"$WORK_DIR/data\" -o \"-p $PORT -k $WORK_DIR\" -l \"$WORK_DIR/postgres.log\" -w start" >/dev/null

export PGHOST="$WORK_DIR" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres

psql -q -v ON_ERROR_STOP=1 -c 'alter database postgres set search_path to "$user", public, extensions;'
psql -q -v ON_ERROR_STOP=1 -f "$ROOT_DIR/scripts/sql/supabase-shim.sql"

for migration in "$ROOT_DIR"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  psql -q -v ON_ERROR_STOP=1 -f "$migration"
done

echo
echo "Running pgTAP suite"
pg_prove --ext .sql -r "$ROOT_DIR/supabase/tests/database"
