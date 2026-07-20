#!/usr/bin/env bash
# SavedData persistence probe (FOUNDATION_PLAN D1): boots the dedicated server
# against the same world dir and proves the `cuprum_state_probe` SavedData file
# written by boot #1 is re-read on boot #2 through the Fabric null-DataFixTypes
# path. This script is the ONLY layer that proves a fresh-JVM disk re-read; the
# GameTests cover the codec envelope and the in-process DimensionDataStorage
# write path (no public API can evict the storage cache within one JVM).
#
#   * boot 1 (fresh run dir)        must log exactly `cuprum_state_probe boots=1`,
#   * boot 2 (PRESERVE_RUN_DIR=1)   must log exactly `cuprum_state_probe boots=2`
#                                   and no other count (negative guard),
#   * boot 3 (fresh run dir again)  must log exactly `boots=1` again — proves the
#                                   default (non-preserving) mode really wipes.
#
# Regexes match the EXACT count: `boots=1([^0-9]|$)` cannot be satisfied by
# boots=10/11/…; the static self-test below proves that before any boot.
#
# All process handling is delegated to server_smoke.sh, which records the exact
# gradle PID and only ever kills that PID's own process tree (never by name).
# W1B extends this probe to also require the `cuprum_charge_graph` re-read line.
set -euo pipefail

cd "$(dirname "$0")/.."

SMOKE=scripts/server_smoke.sh
LOG=build/serverSmoke-console.log

BOOTS1_RE='cuprum_state_probe boots=1([^0-9]|$)'
BOOTS2_RE='cuprum_state_probe boots=2([^0-9]|$)'
# Any count other than the expected one (0, wrong single digit, or >= 2 digits).
WRONG_AFTER_BOOT1_RE='cuprum_state_probe boots=(0|[2-9]|[0-9]{2,})([^0-9]|$)'
WRONG_AFTER_BOOT2_RE='cuprum_state_probe boots=(0|1|[3-9]|[0-9]{2,})([^0-9]|$)'

# --- static regex self-test (adversarial; runs before any server boot) -------
must_match() {
    if ! printf '%s\n' "$2" | grep -Eq "$1"; then
        echo "SELF-TEST FAIL: regex '$1' must match '$2'" >&2
        exit 1
    fi
}
must_not_match() {
    if printf '%s\n' "$2" | grep -Eq "$1"; then
        echo "SELF-TEST FAIL: regex '$1' must NOT match '$2'" >&2
        exit 1
    fi
}
must_match     "$BOOTS1_RE" '[state] cuprum_state_probe boots=1'
must_not_match "$BOOTS1_RE" '[state] cuprum_state_probe boots=10'
must_not_match "$BOOTS1_RE" '[state] cuprum_state_probe boots=12'
must_not_match "$BOOTS1_RE" '[state] cuprum_state_probe boots=2'
must_match     "$BOOTS2_RE" '[state] cuprum_state_probe boots=2'
must_not_match "$BOOTS2_RE" '[state] cuprum_state_probe boots=20'
must_not_match "$BOOTS2_RE" '[state] cuprum_state_probe boots=21'
must_not_match "$BOOTS2_RE" '[state] cuprum_state_probe boots=1'
must_match     "$WRONG_AFTER_BOOT1_RE" '[state] cuprum_state_probe boots=0'
must_match     "$WRONG_AFTER_BOOT1_RE" '[state] cuprum_state_probe boots=10'
must_not_match "$WRONG_AFTER_BOOT1_RE" '[state] cuprum_state_probe boots=1'
must_match     "$WRONG_AFTER_BOOT2_RE" '[state] cuprum_state_probe boots=1'
must_match     "$WRONG_AFTER_BOOT2_RE" '[state] cuprum_state_probe boots=21'
must_not_match "$WRONG_AFTER_BOOT2_RE" '[state] cuprum_state_probe boots=2'
echo "regex self-test passed (exact-count matching verified)"

# --- boot 1: fresh world, expect exactly boots=1 ------------------------------
echo "== restart probe: boot 1/3 (fresh world; expecting boots=1) =="
REQUIRE_LOG_REGEX="$BOOTS1_RE" "$SMOKE" \
    || { echo "FAIL: first boot did not log boots=1" >&2; exit 1; }
if grep -Eq "$WRONG_AFTER_BOOT1_RE" "$LOG"; then
    echo "FAIL: first boot logged an unexpected boots value" >&2
    grep -E 'cuprum_state_probe boots=' "$LOG" >&2 || true
    exit 1
fi

# --- boot 2: same world, expect exactly boots=2 (negative guard included) ----
echo "== restart probe: boot 2/3 (same world; expecting boots=2) =="
PRESERVE_RUN_DIR=1 REQUIRE_LOG_REGEX="$BOOTS2_RE" "$SMOKE" \
    || { echo "FAIL: second boot did not log boots=2 (SavedData not re-read?)" >&2; exit 1; }
if grep -Eq "$WRONG_AFTER_BOOT2_RE" "$LOG"; then
    echo "FAIL: second boot logged a boots value other than 2" >&2
    grep -E 'cuprum_state_probe boots=' "$LOG" >&2 || true
    exit 1
fi

# --- boot 3: fresh world again — the default mode must wipe, not preserve ----
echo "== restart probe: boot 3/3 (fresh world again; expecting boots=1) =="
REQUIRE_LOG_REGEX="$BOOTS1_RE" "$SMOKE" \
    || { echo "FAIL: third (fresh) boot did not log boots=1 — default run-dir wipe broken?" >&2; exit 1; }
if grep -Eq "$WRONG_AFTER_BOOT1_RE" "$LOG"; then
    echo "FAIL: third boot logged an unexpected boots value" >&2
    grep -E 'cuprum_state_probe boots=' "$LOG" >&2 || true
    exit 1
fi

echo "OK: cuprum_state_probe persisted across a dedicated-server restart (boots=1 -> 2, fresh again -> 1)"
