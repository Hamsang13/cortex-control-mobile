#!/bin/bash
# Pi firmware reads this before Linux starts, including on the first SD boot.
set -euo pipefail
config=${1:-/boot/firmware/config.txt}
test -f "$config"
marker='# Cortex Remote: Zero 2 W USB host'
if ! grep -Fxq "$marker" "$config"; then
    printf '\n%s\n' "$marker" >> "$config"
    printf '%s\n' '[all]' '[pi02]' 'dtoverlay=dwc2,dr_mode=host' '[all]' >> "$config"
fi
