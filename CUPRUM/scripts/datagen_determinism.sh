#!/usr/bin/env bash
# Datagen determinism check: runs Fabric datagen twice and fails if the generated
# output under src/main/generated differs between runs, or if datagen touched any
# other tracked file inside this project. Normal Gradle/run artifacts (build/, run/,
# .gradle/, the datagen .cache) are ignored.
set -euo pipefail

cd "$(dirname "$0")/.."
GENERATED=src/main/generated

hash_generated() {
    # Stable, machine-independent digest of the generated tree (cache excluded).
    (cd "$GENERATED" && find . -type f ! -path './.cache/*' -print0 | sort -z \
        | xargs -0 sha256sum) | sha256sum | cut -d' ' -f1
}

tracked_dirty() {
    # Tracked-file modifications inside this project only; gitignored artifacts
    # (build/, run/, .gradle/, generated .cache) never show up here.
    # NOTE: this check is only meaningful once the CUPRUM tree is committed
    # (untracked files are invisible to --untracked-files=no). The sha256 tree
    # hash comparison above/below is the primary, always-valid determinism check;
    # in CI the committed src/main/generated tree additionally gets a
    # `git diff --exit-code` freshness gate (see .github/workflows/cuprum-ci.yml).
    git status --porcelain --untracked-files=no -- . || true
}

echo "== datagen run 1"
./gradlew runDatagen --console=plain --quiet
HASH1=$(hash_generated)
DIRTY1=$(tracked_dirty)

echo "== datagen run 2"
./gradlew runDatagen --rerun --console=plain --quiet
HASH2=$(hash_generated)
DIRTY2=$(tracked_dirty)

echo "run1 sha256: $HASH1"
echo "run2 sha256: $HASH2"

if [[ "$HASH1" != "$HASH2" ]]; then
    echo "FAIL: datagen output differs between runs" >&2
    exit 1
fi

if [[ "$DIRTY1" != "$DIRTY2" ]]; then
    echo "FAIL: tracked-file status changed between datagen runs:" >&2
    diff <(echo "$DIRTY1") <(echo "$DIRTY2") >&2 || true
    exit 1
fi

echo "OK: datagen output is deterministic"
