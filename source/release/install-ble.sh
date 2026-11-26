#!/usr/bin/env bash
# Optional system component, installed once alongside the existing qc-desk service.
set -euo pipefail
cd "$(dirname "$0")/.."
account=${1:?provide the qc-desk service user}
config=${2:?provide the absolute pi-settings.json path}
id "$account" >/dev/null
[[ $config == /* && -f $config ]]
runuser -u "$account" -- test -r "$config"
if ! command -v bluetoothctl >/dev/null || ! /usr/bin/python3 -c "import cryptography, dbus_next" 2>/dev/null; then
    apt-get update
    apt-get install -y bluez python3-cryptography python3-dbus-next
fi
install -d /usr/local/lib/qc-desk/ble
install -m 0644 ble-test/{bridge.py,remote_rpc.py} /usr/local/lib/qc-desk/ble/
cat >/etc/systemd/system/cortex-ble.service <<EOF
[Unit]
Description=Cortex Remote Bluetooth transport
Requires=bluetooth.service
After=bluetooth.service qc-desk.service
[Service]
User=$account
SupplementaryGroups=bluetooth
Environment="QC_PI_CONFIG=$config"
ExecStart=/usr/bin/python3 /usr/local/lib/qc-desk/ble/bridge.py
Restart=on-failure
RestartSec=4
NoNewPrivileges=yes
[Install]
WantedBy=multi-user.target
EOF
if systemctl is-active --quiet cortex-ble-test.service; then systemctl stop cortex-ble-test.service; fi
systemctl daemon-reload
systemctl enable cortex-ble.service
systemctl restart cortex-ble.service
