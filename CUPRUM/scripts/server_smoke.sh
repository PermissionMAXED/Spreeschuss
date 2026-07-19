#!/usr/bin/env bash
# Dedicated-server smoke test:
#   * accepts the EULA in the isolated run dir (build/run/serverSmoke),
#   * preseeds server.properties (isolated port, offline mode) so the boot has no
#     spurious missing-property errors and never clashes with other local servers,
#   * launches the dev dedicated server non-interactively (nogui),
#   * waits for the "Done (...)!" line,
#   * asks the server to stop via console ("stop" on stdin),
#   * on timeout falls back to terminating the exact recorded PID and its process
#     tree (never by name) and FAILS: a forced kill is not a clean stop,
#   * fails on FATAL / ERROR lines and on common-side loading of client classes.
#
# Uses only POSIX-ish tools available on GitHub runners (bash, grep, ps); no rg.
set -euo pipefail

cd "$(dirname "$0")/.."

RUN_DIR=build/run/serverSmoke
LOG=build/serverSmoke-console.log
BOOT_TIMEOUT="${BOOT_TIMEOUT:-600}"
STOP_TIMEOUT="${STOP_TIMEOUT:-120}"
SMOKE_PORT="${SMOKE_PORT:-25599}"

rm -rf "$RUN_DIR" "$LOG"
mkdir -p "$RUN_DIR" "$(dirname "$LOG")"
echo 'eula=true' > "$RUN_DIR/eula.txt"
{
    echo "server-port=$SMOKE_PORT"
    echo 'online-mode=false'
    echo 'sync-chunk-writes=false'
} > "$RUN_DIR/server.properties"

# FIFO for the server console; created inside a private mktemp -d (no mktemp -u).
TMP_DIR=$(mktemp -d /tmp/cuprum-server-smoke-XXXXXX)
FIFO="$TMP_DIR/console.fifo"
mkfifo "$FIFO"

GRADLE_PID=""

# Kill an exact PID and all of its descendants (children first). Never kills by name.
kill_tree() {
    local pid="$1" sig="${2:-TERM}" child
    for child in $(ps -o pid= --ppid "$pid" 2>/dev/null); do
        kill_tree "$child" "$sig"
    done
    kill -s "$sig" "$pid" 2>/dev/null || true
}

# Defensive EXIT trap: runs on EVERY exit path (success, fail(), set -e aborts,
# signals). If the recorded gradle process tree is still alive it is terminated —
# by exact PIDs discovered through parent/child relationships only, never by name —
# and the FIFO tempdir is removed. On a clean stop the tree is already gone, so the
# trap is a no-op apart from the tempdir removal (the clean-stop vs forced-kill
# verdict is decided before this runs and is not affected by it).
cleanup() {
    if [[ -n "$GRADLE_PID" ]] && kill -0 "$GRADLE_PID" 2>/dev/null; then
        echo "cleanup(EXIT): recorded PID $GRADLE_PID still alive; terminating its process tree" >&2
        kill_tree "$GRADLE_PID" TERM
        sleep 5
        kill_tree "$GRADLE_PID" KILL
    fi
    exec 3>&- 2>/dev/null || true
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $1" >&2
    tail -50 "$LOG" >&2 || true
    if [[ -n "$GRADLE_PID" ]] && kill -0 "$GRADLE_PID" 2>/dev/null; then
        echo "cleaning up recorded PID $GRADLE_PID and its process tree" >&2
        kill_tree "$GRADLE_PID" TERM
        sleep 5
        kill_tree "$GRADLE_PID" KILL
    fi
    exit 1
}

# Keep the FIFO writable for the whole run so gradle's stdin stays open.
exec 3<>"$FIFO"

# Process ownership: --no-daemon keeps the Gradle launcher, the Gradle build JVM and
# the forked Minecraft server JVM all inside ONE process tree rooted at the recorded
# $GRADLE_PID. (With the daemon, the server would be a child of the long-lived daemon
# process instead, and killing our recorded PID could leak it.) That makes
# kill_tree($GRADLE_PID) a precise, exact-PID cleanup of everything this script started.
./gradlew runServerSmoke --no-daemon --console=plain < "$FIFO" > "$LOG" 2>&1 &
GRADLE_PID=$!
echo "gradle pid: $GRADLE_PID"

# Wait for Done, watching for early exit or fatal output.
for ((i = 0; i < BOOT_TIMEOUT; i++)); do
    if grep -Eq 'Done \([0-9.]+s\)!' "$LOG" 2>/dev/null; then
        break
    fi
    if ! kill -0 "$GRADLE_PID" 2>/dev/null; then
        fail "server process exited before reaching Done"
    fi
    sleep 1
done
grep -Eq 'Done \([0-9.]+s\)!' "$LOG" || fail "server did not reach Done within ${BOOT_TIMEOUT}s"
echo "server reached Done"

# Health checks on the console log.
if grep -Eqi '\bFATAL\b' "$LOG"; then
    fail "FATAL lines found in server log"
fi
if grep -Eq '/(ERROR|FATAL)\]|\[STDERR\]:? *(Exception|Error)|^[[:space:]]*(Exception|java\.lang\..*Error)' "$LOG"; then
    fail "ERROR lines found in server log"
fi
if grep -Eq 'ClassNotFoundException: net\.minecraft\.client|NoClassDefFoundError: net/minecraft/client' "$LOG"; then
    fail "dedicated server attempted to load client-only classes"
fi

# Graceful stop via server console.
echo 'stop' >&3
FORCED_KILL=0
for ((i = 0; i < STOP_TIMEOUT; i++)); do
    if ! kill -0 "$GRADLE_PID" 2>/dev/null; then
        break
    fi
    sleep 1
done

if kill -0 "$GRADLE_PID" 2>/dev/null; then
    echo "console stop timed out; force-terminating recorded PID $GRADLE_PID (process tree)" >&2
    FORCED_KILL=1
    kill_tree "$GRADLE_PID" TERM
    sleep 5
    kill_tree "$GRADLE_PID" KILL
fi

GRADLE_EXIT=0
wait "$GRADLE_PID" 2>/dev/null || GRADLE_EXIT=$?

# A forced kill is explicitly NOT a clean stop: fail loudly so CI can't mistake it.
if [[ "$FORCED_KILL" == 1 ]]; then
    fail "server had to be force-killed after 'stop' console command (waited ${STOP_TIMEOUT}s)"
fi
if [[ "$GRADLE_EXIT" != 0 ]]; then
    fail "gradle runServerSmoke exited with $GRADLE_EXIT"
fi

grep -q 'Stopping server' "$LOG" || fail "server did not log a clean shutdown"
echo "OK: dedicated server booted to Done and stopped cleanly via console (log: $LOG)"
