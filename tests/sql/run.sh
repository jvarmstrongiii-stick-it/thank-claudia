#!/usr/bin/env bash
# Applies db/migrations/0006 twice to a throwaway local Postgres (never production) and runs the checks.
# Usage: PGHOST=/path/to/socket PGPORT=54329 PGUSER=postgres tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists warranty_test" -c "create database warranty_test"
$P -d warranty_test -f tests/sql/replica-before-0006.sql
$P -d warranty_test -f db/migrations/0006_warranty_registration.sql 2>/dev/null
$P -d warranty_test -f db/migrations/0006_warranty_registration.sql 2>/dev/null   # must be re-runnable
$P -d warranty_test -f tests/sql/checks-after-0006.sql
