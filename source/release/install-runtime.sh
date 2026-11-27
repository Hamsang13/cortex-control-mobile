#!/bin/bash
# Install service definitions into a real Pi or the image build chroot.
set -euo pipefail
account=$1
app=$2
mode=$3
cd "$(dirname "$0")/.."
runtime=/usr/local/lib/qc-desk
install -d -m 0755 "$runtime"
install -m 0644 pi_settings.py release/{phone_wifi.py,firstboot.py,package.py,updater.py,update-public.pem} "$runtime/"
# The base image is itself an installed build. Seed its rollback floor.
channel=${QC_CHANNEL:-preview}
seq=0
if [[ -f manifest.json ]]; then
    seq=$(python3 -c 'import json; print(int(json.load(open("manifest.json"))["sequence"]))')
elif git -c safe.directory="*" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    seq=$(git -c safe.directory="*" rev-list --first-parent --count HEAD)
fi
if [[ $channel == stable ]]; then install -m 0644 release/stable-public.pem "$runtime/update-public.pem"; fi
printf '{"channel":"%s","baseSequence":%d}\n' "$channel" "$seq" > "$runtime/policy.json"
install -m 0755 release/hotspot.sh "$runtime/"
install -d -o "$account" -g "$(id -gn "$account")" "$app"
install -m 0644 server.py editor.py demo.py device_settings.py pi_settings.py io_settings.py plugin_sync.py plugin-names.json utilities.py pitch.py index.html app.js "$app/"
usermod -aG plugdev,audio "$account"
echo 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="152a", ATTRS{idProduct}=="880a", GROUP="plugdev", MODE="0660"' > /etc/udev/rules.d/75-qc-desk.rules
cat > /etc/systemd/system/qc-desk-hotspot.service <<EOF
[Unit]
Description=Configure Cortex Remote hotspot
After=NetworkManager.service
Requires=NetworkManager.service
[Service]
Type=oneshot
TimeoutStartSec=infinity
ExecStart=/usr/local/lib/qc-desk/hotspot.sh "$account" "$app"
RemainAfterExit=yes
Restart=on-failure
RestartSec=4
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/qc-desk.service <<EOF
[Unit]
Description=Cortex Remote
Requires=qc-desk-hotspot.service
After=qc-desk-hotspot.service
[Service]
User=$account
SupplementaryGroups=plugdev audio
Environment="QC_PI_CONFIG=$app/pi-settings.json"
Environment="QC_DATA_DIR=$app"
ExecStart="$app/venv/bin/python" /usr/local/lib/qc-desk/updater.py
Restart=on-failure
RestartSec=2
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/cortex-network.service <<EOF
[Unit]
Description=Cortex Remote phone hotspot connection and recovery
After=qc-desk-hotspot.service
Requires=qc-desk-hotspot.service
[Service]
ExecStart=/usr/bin/python3 -I "$runtime/phone_wifi.py" "$account"
RuntimeDirectory=cortex-network
RuntimeDirectoryMode=0755
StateDirectory=cortex-network
StateDirectoryMode=0700
Restart=on-failure
RestartSec=2
NoNewPrivileges=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/etc/NetworkManager/system-connections
[Install]
WantedBy=multi-user.target
EOF
bash release/install-welcome.sh "$account" "$app" "$mode"
systemctl enable qc-desk-hotspot qc-desk cortex-network
if [[ $mode == live ]]; then
    udevadm control --reload-rules
    udevadm trigger --subsystem-match=hidraw --action=add
    systemctl daemon-reload
    systemctl restart qc-desk cortex-network
fi
