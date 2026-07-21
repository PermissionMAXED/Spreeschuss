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
SCREENSHOT_DIR=build/run/clientGameTest/screenshots
mkdir -p build
rm -rf "$SCREENSHOT_DIR"
rm -f "$LOG"

# Fabric API 0.134.1's client-GameTest network synchronizer is a known flaky layer when tests
# close and reopen singleplayer worlds under Xvfb. Fabric's documented workaround is test-only;
# JAVA_TOOL_OPTIONS reaches both Gradle and the forked Minecraft JVM without broadening the
# narrowly owned build.gradle client-test-resource configuration.
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:+${JAVA_TOOL_OPTIONS} }-Dfabric.client.gametest.disableNetworkSynchronizer=true"

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
#   * telemetry/keystore chatter,
#   * Mod Menu's dev-only update checker being interrupted after the client has stopped.
scan_log() {
    local file="$1"
    [[ -f "$file" ]] || return 0
    # 'crash-reports' (with s) matches the crash dump directory but not the
    # fabric-crash-report-info-v1 module name that appears in mod lists.
    grep -E '/(ERROR|FATAL)\]|FATAL|Mixin apply failed|Failed to load mod|Incompatible mods|ModResolutionException|Exception in thread|crash-reports' "$file" \
        | grep -Ev 'Error starting SoundSystem|[Rr]ealms|Failed to verify authentication|Authentication server|Session service|Could not authorize you|Failed to fetch (profile|user) properties|Sound engine|OpenAL|No audio device|Failed to open .*audio|Telemetry|keystore|Mod Menu/Update Checker' \
        || true
}

PROBLEMS=$( { scan_log "$LOG"; scan_log build/run/clientGameTest/logs/latest.log; } )
if [[ -n "$PROBLEMS" ]]; then
    echo "FAIL: fatal/error lines found in client logs:" >&2
    echo "$PROBLEMS" >&2
    exit 1
fi

# The exact W1A + W1C + W1D screenshot set must come from THIS launch. The directory was deleted
# above, so stale files can neither satisfy a missing capture nor hide a numbering regression.
EXPECTED_SCREENSHOTS=(
    0000_cuprum_title_screen.png
    0001_cuprum_charge_probe_in_world.png
    0002_cuprum_diagnostic_coil_formed.png
    0003_cuprum_charge_machine_screen.png
    0004_cuprum_fx_ripple_t1.png
    0005_cuprum_fx_ripple_t2.png
    0006_cuprum_fx_ripple_t3_motes.png
    0007_cuprum_fx_ripple_t1_colorblind.png
    0008_cuprum_handbook_landing.png
    0009_cuprum_handbook_charge_probe_page.png
    0010_cuprum_handbook_search_results_en.png
    0011_cuprum_handbook_search_results_de.png
    0012_cuprum_handbook_bookmark_rail.png
    0013_cuprum_handbook_locked_page.png
    0014_cuprum_handbook_unlocked_page.png
)
for expected in "${EXPECTED_SCREENSHOTS[@]}"; do
    if [[ ! -s "$SCREENSHOT_DIR/$expected" ]]; then
        echo "FAIL: expected screenshot $SCREENSHOT_DIR/$expected is missing or empty" >&2
        ls -la "$SCREENSHOT_DIR" >&2 2>/dev/null || true
        exit 1
    fi
done
shopt -s nullglob
ACTUAL_SCREENSHOTS=("$SCREENSHOT_DIR"/*.png)
if [[ "${#ACTUAL_SCREENSHOTS[@]}" -ne "${#EXPECTED_SCREENSHOTS[@]}" ]]; then
    echo "FAIL: expected exactly ${#EXPECTED_SCREENSHOTS[@]} screenshots, found ${#ACTUAL_SCREENSHOTS[@]}" >&2
    ls -la "$SCREENSHOT_DIR" >&2
    exit 1
fi
echo "OK: client gametest passed; logs clean; screenshots:"
ls -la "$SCREENSHOT_DIR"
