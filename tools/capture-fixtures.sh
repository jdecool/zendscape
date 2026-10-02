#!/usr/bin/env bash
# Regenerates fixtures/<scenario>.{t0,t1}.rmem from scenarios/*.php.
# Usage: tools/capture-fixtures.sh [scenario ...]
set -euo pipefail

# Must match the reliforp/reli-prof version pinned in backend/composer.json.
RELI_IMAGE=reliforp/reli-prof:0.12.0

root=$(cd "$(dirname "$0")/.." && pwd)

if [ $# -eq 0 ]; then
    set -- $(cd "$root/scenarios" && ls *.php | grep -v '^harness.php$' | sed 's/\.php$//')
fi

# ptrace needs these privileges, and the target must share the container's PID namespace.
docker run --rm \
    --cap-add SYS_PTRACE --security-opt seccomp=unconfined \
    -v "$root:/repo" --entrypoint bash "$RELI_IMAGE" \
    /repo/tools/capture-in-container.sh "$@"
