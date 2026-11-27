#!/bin/bash
# Run from a trusted checkout as the current qc-desk service user.
set -euo pipefail
cd "$(dirname "$0")/.."
runtime=/usr/local/lib/qc-desk
app=${1:?Pass the installed QC_DATA_DIR}
test -f "$app/pi-settings.json"
test "$(systemctl show qc-desk -p User --value)" = "$(id -un)"
cmp release/update-public.pem "$runtime/update-public.pem"
if [[ -f "$runtime/policy.json" ]]; then
    python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["channel"]=="preview"' "$runtime/policy.json"
fi
# Preserve existing trust, running version, and rollback state.
sudo install -m 0644 release/{package.py,updater.py,firstboot.py} pi_settings.py "$runtime/"
if [[ ! -f "$runtime/policy.json" ]]; then
    # Legacy packages have no sequence; the new verifier rejects all such packages.
    printf '%s\n' '{"channel":"preview","baseSequence":0}' | sudo tee "$runtime/policy.json" >/dev/null
fi
sudo systemctl restart qc-desk
# Install through the migrated verifier; legacy app servers do not verify channel metadata.
QC_DATA_DIR="$app" PYTHONPATH="$runtime" "$app/venv/bin/python" -I - "$runtime" <<'PY'
import sys,time
sys.path.insert(0,sys.argv[1])
from pi_settings import online_update
from updater import state
release=online_update()
if release["available"]:
    ticket=online_update(release["build"],True)["ticket"]
    for _ in range(65):
        time.sleep(1)
        current=state()
        if current.get("ticket")==ticket and current["status"]=="applied": break
        if current.get("ticket")==ticket and current["status"]=="rollback": sys.exit("Update rolled back")
    else: sys.exit("App startup not confirmed")
PY
