#!/usr/bin/env bash
set -euo pipefail

reli() { php -d memory_limit=-1 /app/reli "$@" > /dev/null; }

capture() {
    local scenario=$1 signals
    signals=$(mktemp -d)

    ZENDSCAPE_SIGNALS="$signals" php "/repo/scenarios/${scenario}.php" &
    local pid=$!
    while [ ! -s "$signals/pid" ]; do sleep 0.1; done

    reli inspector:memory:dump --pid="$pid" --output="$signals/t0.rdump"
    touch "$signals/grow"
    while [ ! -f "$signals/grown" ]; do sleep 0.1; done
    reli inspector:memory:dump --pid="$pid" --output="$signals/t1.rdump"
    kill "$pid"

    for phase in t0 t1; do
        reli inspector:memory:analyze "$signals/$phase.rdump" -f rmem -o "$signals/$phase.rmem"
        php /repo/tools/verify-fixture.php "$signals/$phase.rmem" || return 1
    done

    mv "$signals/t0.rmem" "/repo/fixtures/${scenario}.t0.rmem"
    mv "$signals/t1.rmem" "/repo/fixtures/${scenario}.t1.rmem"
    rm -rf "$signals"
}

for scenario in "$@"; do
    # reli 0.12.0 intermittently captures an empty objects_store (docs/spike-0.md), so retry.
    for attempt in 1 2 3; do
        if capture "$scenario"; then
            echo "captured $scenario"
            continue 2
        fi
        echo "retrying $scenario (attempt $attempt failed verification)" >&2
    done
    echo "failed to capture $scenario" >&2
    exit 1
done
