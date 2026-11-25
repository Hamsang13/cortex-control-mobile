#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ $(id -u) == 0 ]]; then echo 'Run as your normal Pi user.'; exit 1; fi
sudo -v
sudo apt-get update
sudo apt-get install -y python3-venv libhidapi-hidraw0 network-manager dnsmasq-base usbutils
app="$HOME/.local/share/qc-desk"
mkdir -p "$app"
install -m644 server.py editor.py demo.py device_settings.py pi_settings.py io_settings.py plugin_sync.py plugin-names.json utilities.py pitch.py index.html app.js "$app/"
if [[ -d .device-library ]]; then
    mkdir -p "$app/.device-library"
    for cached in .device-library/*.json; do
        [[ -f "$cached" && ! -e "$app/$cached" ]] || continue
        install -m600 "$cached" "$app/.device-library/"
    done
fi
python3 -m venv "$app/venv"
"$app/venv/bin/pip" install 'pyquadcortex==0.40.0'
"$app/venv/bin/python" -c 'import hid, pyquadcortex'
sudo usermod -aG plugdev "$(id -un)"
echo 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="152a", ATTRS{idProduct}=="880a", GROUP="plugdev", MODE="0660"' | sudo tee /etc/udev/rules.d/75-qc-desk.rules >/dev/null
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=hidraw --action=add
sudo tee /etc/systemd/system/qc-desk.service >/dev/null <<EOF
[Unit]
Description=Cortex Remote USB editor
After=network.target qc-desk-hotspot.service
[Service]
User=$(id -un)
SupplementaryGroups=plugdev audio
Environment="QC_PI_CONFIG=$app/pi-settings.json"
ExecStart="$app/venv/bin/python" "$app/server.py"
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
sudo chmod 600 /etc/systemd/system/qc-desk.service
python3 "$app/pi_settings.py" init "$app/pi-settings.json"
profile=QC-Pedalboard
if ! sudo nmcli connection show "$profile" >/dev/null 2>&1; then
    sudo nmcli connection add type wifi ifname wlan0 con-name "$profile" ssid "$profile" connection.autoconnect no
fi
sudo nmcli connection modify "$profile" wifi.mode ap wifi.band bg wifi-sec.key-mgmt wpa-psk ipv4.method shared ipv6.method disabled connection.autoconnect-priority 999 connection.autoconnect yes
sudo install -D -o root -g root -m 0644 pi_settings.py /usr/local/lib/qc-desk/pi_settings.py
sudo tee /etc/systemd/system/qc-desk-hotspot.service >/dev/null <<EOF
[Unit]
Description=Apply Cortex Remote hotspot settings
After=NetworkManager.service
Requires=NetworkManager.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -I /usr/local/lib/qc-desk/pi_settings.py apply "$app/pi-settings.json"
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable qc-desk-hotspot qc-desk
sudo systemctl restart qc-desk
python3 "$app/pi_settings.py" show "$app/pi-settings.json"
echo 'Save the password and URL, then run: sudo reboot'
