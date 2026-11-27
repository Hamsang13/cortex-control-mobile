#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ $(id -u) == 0 ]]; then echo 'Run as your normal Pi user.'; exit 1; fi
sudo -v
sudo bash release/configure-usb-host.sh
sudo apt-get update
sudo apt-get install -y python3-venv libhidapi-hidraw0 network-manager dnsmasq-base usbutils openssl
app="$HOME/.local/share/qc-desk"
mkdir -p "$app"
python3 -m venv "$app/venv"
"$app/venv/bin/pip" install 'pyquadcortex==0.40.0'
"$app/venv/bin/python" -c 'import hid, pyquadcortex'
python3 pi_settings.py init "$app/pi-settings.json"
profile=QC-Pedalboard
if ! sudo nmcli connection show "$profile" >/dev/null 2>&1; then
    sudo nmcli connection add type wifi ifname wlan0 con-name "$profile" ssid "$profile" connection.autoconnect no
fi
sudo nmcli connection modify "$profile" wifi.mode ap wifi.band bg wifi-sec.key-mgmt wpa-psk ipv4.method shared ipv6.method disabled connection.autoconnect-priority 999 connection.autoconnect yes
sudo bash release/install-runtime.sh "$(id -un)" "$app" live
python3 pi_settings.py show "$app/pi-settings.json"
