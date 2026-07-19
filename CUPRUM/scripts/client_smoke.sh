#!/usr/bin/env bash
# Client smoke test: boots a real Minecraft client under Xvfb and runs the Fabric
# client GameTests (fabric-client-gametest entrypoint), which capture a title-screen
# and an in-world screenshot into build/run/clientGameTest/screenshots.
#
# After the run the console + game logs are inspected for fatal/crash/mod-loading
# errors. Expected headless noise (offline auth, missing audio device, telemetry)
# is allowlisted; anything else fails the smoke test.
#
# Uses only tools available on GitHub runners (bash, grep, xvfb-run); no rg.
set -euo pipefail

cd "$(dirname "$0")/.."

LOG=build/clientSmoke-console.log
mkdir -p build
rm -f "$LOG"

GRADLE_EXIT=0
if [[ -n "${DISPLAY:-}" ]]; then
    ./gradlew runClientGameTest --console=plain > "$LOG" 2>&1 || GRADLE_EXIT=$?
else
    xvfb-run --auto-servernum ./gradlew runClientGameTest --console=plain > "$LOG" 2>&1 || GRADLE_EXIT=$?
fi
tail -25 "$LOG"

if [[ "$GRADLE_EXIT" != 0 ]]; then
    echo "FAIL: runClientGameTest exited with $GRADLE_EXIT (full log: $LOG)" >&2
    tail -100 "$LOG" >&2
    exit 1
fi

# Crash reports are always fatal.
if ls build/run/clientGameTest/crash-reports/* >/dev/null 2>&1; then
    echo "FAIL: crash reports were produced:" >&2
    ls -la build/run/clientGameTest/crash-reports >&2
    exit 1
fi

# Inspect console + latest game log for fatal / crash / mod-loading problems.
# Allowlisted, expected headless noise:
#   * offline-session auth failures (no real Mojang account in dev),
#   * missing sound hardware (Xvfb has no audio device),
#   * telemetry/keystore chatter.
scan_log() {
    local file="$1"
    [[ -f "$file" ]] || return 0
    # 'crash-reports' (with s) matches the crash dump directory but not the
    # fabric-crash-report-info-v1 module name that appears in mod lists.
    grep -E '/(ERROR|FATAL)\]|FATAL|Mixin apply failed|Failed to load mod|Incompatible mods|ModResolutionException|Exception in thread|crash-reports' "$file" \
        | grep -Ev 'Error starting SoundSystem|[Rr]ealms|Failed to verify authentication|Authentication server|Session service|Could not authorize you|Failed to fetch (profile|user) properties|Sound engine|OpenAL|No audio device|Failed to open .*audio|Telemetry|keystore' \
        || true
}

PROBLEMS=$( { scan_log "$LOG"; scan_log build/run/clientGameTest/logs/latest.log; } )
if [[ -n "$PROBLEMS" ]]; then
    echo "FAIL: fatal/error lines found in client logs:" >&2
    echo "$PROBLEMS" >&2
    exit 1
fi

# Both named screenshots from CuprumClientGameTest must exist (any-PNG is not enough:
# the counter prefix and names are deterministic for the test's screenshot order).
SCREENSHOT_DIR=build/run/clientGameTest/screenshots
for expected in 0000_cuprum_title_screen.png 0001_cuprum_charge_probe_in_world.png; do
    if [[ ! -s "$SCREENSHOT_DIR/$expected" ]]; then
        echo "FAIL: expected screenshot $SCREENSHOT_DIR/$expected is missing or empty" >&2
        ls -la "$SCREENSHOT_DIR" >&2 2>/dev/null || true
        exit 1
    fi
done
echo "OK: client gametest passed; logs clean; screenshots:"
ls -la "$SCREENSHOT_DIR"
