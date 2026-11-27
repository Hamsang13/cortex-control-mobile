#!/bin/bash
# Install the optional Waveshare hardware worker; invoke with sudo.
set -euo pipefail
cd "$(dirname "$0")"
account=${1:-$(systemctl show -p User --value qc-desk.service)}
test -n "$account"
id "$account" >/dev/null
if ! /usr/bin/python3 -c 'import spidev,lgpio,PIL' || [[ ! -r /usr/share/fonts/truetype/nanum/NanumGothic.ttf ]]; then
    apt-get update
    apt-get install -y --no-install-recommends python3-lgpio python3-spidev python3-pil fonts-nanum
fi
install -D -m 0644 lcd.py /usr/local/lib/qc-desk/lcd.py
cat >/etc/systemd/system/cortex-lcd.service <<EOF
[Unit]
Description=Cortex Remote SPI display
After=local-fs.target
[Service]
User=$account
SupplementaryGroups=gpio spi
RuntimeDirectory=cortex-lcd
RuntimeDirectoryMode=0700
WorkingDirectory=/run/cortex-lcd
ExecStart=/usr/bin/python3 -I /usr/local/lib/qc-desk/lcd.py
Restart=on-failure
RestartSec=4
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable cortex-lcd.service
if [[ -c /dev/spidev0.0 ]]; then
    systemctl restart cortex-lcd.service
else
    raspi-config nonint do_spi 0
    echo "SPI enabled. Reboot the remote device to start the LCD."
fi
