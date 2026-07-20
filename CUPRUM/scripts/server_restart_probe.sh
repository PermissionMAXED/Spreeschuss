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
# W1B extends this probe with a non-empty charge-graph fixture (one normalized node
# shadow + a nonzero vent counter) and requires those exact values on boot #2.
set -euo pipefail

cd "$(dirname "$0")/.."

SMOKE=scripts/server_smoke.sh
LOG=build/serverSmoke-console.log

BOOTS1_RE='cuprum_state_probe boots=1([^0-9]|$)'
BOOTS2_RE='cuprum_state_probe boots=2([^0-9]|$)'
# Any count other than the expected one (0, wrong single digit, or >= 2 digits).
WRONG_AFTER_BOOT1_RE='cuprum_state_probe boots=(0|[2-9]|[0-9]{2,})([^0-9]|$)'
WRONG_AFTER_BOOT2_RE='cuprum_state_probe boots=(0|1|[3-9]|[0-9]{2,})([^0-9]|$)'

# --- W1B: cuprum_charge_graph SavedData created-vs-re-read proof -------------
# The manager logs exactly one anchored line per dimension at world load:
#   [charge] cuprum_charge_graph created dim=<dim> nodes=<n> vented_total=<v>   (no file on disk)
#   [charge] cuprum_charge_graph re-read dim=<dim> nodes=<n> vented_total=<v>   (true disk parse)
# `re-read` is only ever logged when DimensionDataStorage.get() returned a non-null
# instance parsed from the .dat file, so requiring it (plus the on-disk artifact
# check below) proves an actual disk re-read — not mere presence of a boot line.
CG_CREATED_ANY_RE='\[charge\] cuprum_charge_graph created dim=[a-z0-9_.:/-]+ nodes=[0-9]+ vented_total=[0-9]+'
CG_REREAD_ANY_RE='\[charge\] cuprum_charge_graph re-read dim=[a-z0-9_.:/-]+ nodes=[0-9]+ vented_total=[0-9]+'
CG_CREATED_OW_RE='\[charge\] cuprum_charge_graph created dim=minecraft:overworld nodes=[0-9]+ vented_total=[0-9]+'
CG_REREAD_OW_RE='\[charge\] cuprum_charge_graph re-read dim=minecraft:overworld nodes=[0-9]+ vented_total=[0-9]+'
CG_REREAD_NONEMPTY_OW_RE='\[charge\] cuprum_charge_graph re-read dim=minecraft:overworld nodes=1 vented_total=678([^0-9]|$)'
# Overworld SavedData artifact written by boot 1 and parsed by boot 2.
CG_DATA_FILE=build/run/serverSmoke/world/data/cuprum_charge_graph.dat

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

# W1B charge-graph regexes: created/re-read must be mutually exclusive and anchored.
must_match     "$CG_CREATED_OW_RE" '[charge] cuprum_charge_graph created dim=minecraft:overworld nodes=0 vented_total=0'
must_match     "$CG_CREATED_ANY_RE" '[charge] cuprum_charge_graph created dim=minecraft:the_nether nodes=3 vented_total=250000'
must_not_match "$CG_CREATED_OW_RE" '[charge] cuprum_charge_graph re-read dim=minecraft:overworld nodes=0 vented_total=0'
must_not_match "$CG_CREATED_OW_RE" '[charge] cuprum_charge_graph recreated dim=minecraft:overworld nodes=0 vented_total=0'
must_not_match "$CG_CREATED_OW_RE" '[charge] cuprum_charge_graph created dim=minecraft:overworld nodes= vented_total='
must_not_match "$CG_CREATED_OW_RE" '[charge] cuprum_charge_graph created dim=minecraft:the_nether nodes=0 vented_total=0'
must_match     "$CG_REREAD_OW_RE" '[charge] cuprum_charge_graph re-read dim=minecraft:overworld nodes=2 vented_total=250000'
must_match     "$CG_REREAD_NONEMPTY_OW_RE" '[charge] cuprum_charge_graph re-read dim=minecraft:overworld nodes=1 vented_total=678'
must_not_match "$CG_REREAD_NONEMPTY_OW_RE" '[charge] cuprum_charge_graph re-read dim=minecraft:overworld nodes=0 vented_total=0'
must_not_match "$CG_REREAD_NONEMPTY_OW_RE" '[charge] cuprum_charge_graph re-read dim=minecraft:overworld nodes=1 vented_total=6780'
must_match     "$CG_REREAD_ANY_RE" '[charge] cuprum_charge_graph re-read dim=minecraft:the_end nodes=0 vented_total=0'
must_not_match "$CG_REREAD_OW_RE" '[charge] cuprum_charge_graph created dim=minecraft:overworld nodes=2 vented_total=250000'
must_not_match "$CG_REREAD_OW_RE" '[charge] cuprum_charge_graph re-read dim=minecraft:the_nether nodes=2 vented_total=0'
must_not_match "$CG_REREAD_ANY_RE" '[charge] cuprum_charge_graph re-read dim=minecraft:overworld nodes=x vented_total=y'
echo "regex self-test passed (exact-count matching verified)"

# W1B post-boot charge-graph verdict; args: <boot-label> <created|re-read>.
check_charge_graph() {
    local label="$1" mode="$2"
    if [[ "$mode" == created ]]; then
        if ! grep -Eq "$CG_CREATED_OW_RE" "$LOG"; then
            echo "FAIL: $label did not log the anchored cuprum_charge_graph created line" >&2
            grep -F 'cuprum_charge_graph' "$LOG" >&2 || true
            exit 1
        fi
        if grep -Eq "$CG_REREAD_ANY_RE" "$LOG"; then
            echo "FAIL: $label (fresh world) logged a cuprum_charge_graph re-read line" >&2
            grep -F 'cuprum_charge_graph' "$LOG" >&2 || true
            exit 1
        fi
    else
        if ! grep -Eq "$CG_REREAD_NONEMPTY_OW_RE" "$LOG"; then
            echo "FAIL: $label did not re-read the exact non-empty charge fixture (disk parse missing?)" >&2
            grep -F 'cuprum_charge_graph' "$LOG" >&2 || true
            exit 1
        fi
        if grep -Eq "$CG_CREATED_ANY_RE" "$LOG"; then
            echo "FAIL: $label (preserved world) logged a cuprum_charge_graph created line" >&2
            grep -F 'cuprum_charge_graph' "$LOG" >&2 || true
            exit 1
        fi
    fi
    echo "$label: cuprum_charge_graph $mode verdict OK"
}

# Writes the smallest valid non-empty Cuprum charge SavedData envelope using only
# Python's standard library. Boot #2 must decode this through the real
# DimensionDataStorage/SavedDataType codec path and report the exact values.
write_charge_fixture() {
    python3 - "$CG_DATA_FILE" <<'PY'
import gzip
import pathlib
import struct
import sys

target = pathlib.Path(sys.argv[1])

def name(value):
    raw = value.encode("utf-8")
    return struct.pack(">H", len(raw)) + raw

def tag(tag_type, key, payload):
    return bytes((tag_type,)) + name(key) + payload

node = b"".join((
    tag(4, "posKey", struct.pack(">q", 42)),
    tag(3, "roleMask", struct.pack(">i", 2)),
    tag(3, "priority", struct.pack(">i", 2)),
    tag(4, "lastKnownStored", struct.pack(">q", 12_345)),
    b"\x00",
))
data = b"".join((
    tag(3, "schema_version", struct.pack(">i", 1)),
    tag(9, "nodes", b"\x0a" + struct.pack(">i", 1) + node),
    tag(4, "vented_total", struct.pack(">q", 678)),
    b"\x00",
))
root = b"\x0a\x00\x00" + tag(10, "data", data) + b"\x00"
with target.open("wb") as raw:
    with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
        compressed.write(root)
PY
}

# --- boot 1: fresh world, expect exactly boots=1 ------------------------------
echo "== restart probe: boot 1/3 (fresh world; expecting boots=1) =="
REQUIRE_LOG_REGEX="$BOOTS1_RE" "$SMOKE" \
    || { echo "FAIL: first boot did not log boots=1" >&2; exit 1; }
if grep -Eq "$WRONG_AFTER_BOOT1_RE" "$LOG"; then
    echo "FAIL: first boot logged an unexpected boots value" >&2
    grep -E 'cuprum_state_probe boots=' "$LOG" >&2 || true
    exit 1
fi
check_charge_graph "boot 1" created
# The write proof: boot 1 must leave a real SavedData artifact for boot 2 to parse.
if [[ ! -f "$CG_DATA_FILE" ]]; then
    echo "FAIL: boot 1 did not write $CG_DATA_FILE to disk" >&2
    ls -la "$(dirname "$CG_DATA_FILE")" >&2 || true
    exit 1
fi
echo "boot 1: $CG_DATA_FILE written ($(stat -c%s "$CG_DATA_FILE") bytes)"
write_charge_fixture
echo "boot 1: replaced empty charge snapshot with one-node/678-Cg restart fixture"

# --- boot 2: same world, expect exactly boots=2 (negative guard included) ----
echo "== restart probe: boot 2/3 (same world; expecting boots=2) =="
if [[ ! -f "$CG_DATA_FILE" ]]; then
    echo "FAIL: $CG_DATA_FILE vanished before boot 2" >&2
    exit 1
fi
PRESERVE_RUN_DIR=1 REQUIRE_LOG_REGEX="$BOOTS2_RE" "$SMOKE" \
    || { echo "FAIL: second boot did not log boots=2 (SavedData not re-read?)" >&2; exit 1; }
if grep -Eq "$WRONG_AFTER_BOOT2_RE" "$LOG"; then
    echo "FAIL: second boot logged a boots value other than 2" >&2
    grep -E 'cuprum_state_probe boots=' "$LOG" >&2 || true
    exit 1
fi
check_charge_graph "boot 2" re-read

# --- boot 3: fresh world again — the default mode must wipe, not preserve ----
echo "== restart probe: boot 3/3 (fresh world again; expecting boots=1) =="
REQUIRE_LOG_REGEX="$BOOTS1_RE" "$SMOKE" \
    || { echo "FAIL: third (fresh) boot did not log boots=1 — default run-dir wipe broken?" >&2; exit 1; }
if grep -Eq "$WRONG_AFTER_BOOT1_RE" "$LOG"; then
    echo "FAIL: third boot logged an unexpected boots value" >&2
    grep -E 'cuprum_state_probe boots=' "$LOG" >&2 || true
    exit 1
fi
check_charge_graph "boot 3" created

echo "OK: cuprum_state_probe persisted across a dedicated-server restart (boots=1 -> 2, fresh again -> 1)"
echo "OK: non-empty cuprum_charge_graph SavedData (nodes=1, vented_total=678) re-read on boot 2; fresh boot 3 wiped it"
