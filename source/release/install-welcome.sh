#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
account=${1:-$(systemctl show qc-desk -p User --value)}
if [[ -n ${2:-} ]]; then
    app=$2
else
    app=$(systemctl show qc-desk -p Environment --value | python3 -c 'import shlex,sys; print(next(arg[12:] for arg in shlex.split(sys.stdin.read()) if arg.startswith("QC_DATA_DIR=")))')
fi
test -n "$account"
test -n "$app"
mode=${3:-live}
runtime=/usr/local/lib/qc-desk
install -d "$runtime" /etc/NetworkManager/dnsmasq-shared.d
install -m 0644 welcome.py firstboot.py "$runtime/"
echo 'interface-name=captive.apple.com,wlan0/4' >/etc/NetworkManager/dnsmasq-shared.d/cortex-welcome.conf
cat >/etc/systemd/system/cortex-welcome.service <<EOF
[Unit]
Description=Cortex Remote hotspot welcome screen
After=NetworkManager.service
[Service]
User=$account
ExecStart=/usr/bin/python3 -Es "$runtime/welcome.py" "$app/pi-settings.json"
AmbientCapabilities=CAP_NET_BIND_SERVICE CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_BIND_SERVICE CAP_NET_RAW
StateDirectory=cortex-welcome
StateDirectoryMode=0700
Restart=always
RestartSec=2
NoNewPrivileges=yes
ProtectSystem=strict
[Install]
WantedBy=multi-user.target
EOF
systemctl enable cortex-welcome
if [[ $mode == live ]]; then
    systemctl daemon-reload
    systemctl restart cortex-welcome
fi
