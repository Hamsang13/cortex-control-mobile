#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ $(id -u) == 0 ]]; then echo 'Run as your normal Pi user.'; exit 1; fi
sudo -v
sudo apt-get update
sudo apt-get install -y python3-venv libhidapi-hidraw0 network-manager dnsmasq-base
app="$HOME/.local/share/qc-desk"
mkdir -p "$app"
install -m644 server.py index.html "$app/"
python3 -m venv "$app/venv"
"$app/venv/bin/pip" install 'pyquadcortex==0.40.0'
"$app/venv/bin/python" -c 'import hid,pyquadcortex'
if [[ ! -f "$app/key" ]]; then (umask 077; python3 -c 'import secrets;print(secrets.token_urlsafe(18))' > "$app/key"); fi
key=$(cat "$app/key")
sudo usermod -aG plugdev "$(id -un)"
echo 'SUBSYSTEM=="hidraw", ATTRS{product}=="*Quad Cortex*", GROUP="plugdev", MODE="0660"' | sudo tee /etc/udev/rules.d/75-qc-desk.rules >/dev/null
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=hidraw --action=add
sudo tee /etc/systemd/system/qc-desk.service >/dev/null <<EOF
[Unit]
Description=Quad Desk USB editor
After=network.target
[Service]
User=$(id -un)
SupplementaryGroups=plugdev
Environment=QC_WEB_KEY=$key
ExecStart="$app/venv/bin/python" "$app/server.py"
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
sudo chmod 600 /etc/systemd/system/qc-desk.service
sudo systemctl daemon-reload
sudo systemctl enable qc-desk
sudo systemctl restart qc-desk
profile=QC-Pedalboard
if ! sudo nmcli connection show "$profile" >/dev/null 2>&1; then
    sudo nmcli connection add type wifi ifname wlan0 con-name "$profile" ssid "$profile" connection.autoconnect no
fi
if [[ ! -f "$app/wifi" ]]; then (umask 077; python3 -c 'import secrets;print(secrets.token_hex(8))' > "$app/wifi"); fi
wifi=$(cat "$app/wifi")
sudo nmcli connection modify "$profile" 802-11-wireless.mode ap 802-11-wireless.band bg wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$wifi" ipv4.method shared ipv4.addresses 10.42.0.1/24 ipv6.method disabled connection.autoconnect-priority 999 connection.autoconnect yes
printf '\nWi-Fi: %s\nPassword: %s\niPad Safari: http://10.42.0.1:8765/#%s\n' "$profile" "$wifi" "$key"
echo 'Save the password and URL, then run: sudo reboot'
