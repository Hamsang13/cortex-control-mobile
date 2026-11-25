#!/bin/bash
set -euo pipefail
account=$1
app=$2
runtime=/usr/local/lib/qc-desk
profile=QC-Pedalboard
if [[ ! -f "$app/pi-settings.json" ]]; then
    country=$(tr -d '[:space:]' < /boot/firmware/cortex-country.txt)
    [[ $country =~ ^[A-Z]{2}$ ]]
    raspi-config nonint do_wifi_country "$country"
    rfkill unblock wifi
    nmcli radio wifi on
    # Wait for the hardware and NetworkManager to enumerate wlan0 on cold boot.
    for _ in {1..60}; do nmcli device show wlan0 >/dev/null 2>&1 && break; sleep 1; done
    if ! nmcli connection show "$profile" >/dev/null 2>&1; then
        nmcli connection add type wifi ifname wlan0 con-name "$profile" ssid Cortex-Remote-Setup connection.autoconnect no
    fi
    nmcli connection modify "$profile" wifi.ssid Cortex-Remote-Setup wifi.mode ap wifi.band bg wifi.channel 6 wifi-sec.key-mgmt wpa-psk wifi-sec.psk CortexSetup1 ipv4.method shared ipv4.addresses 10.42.0.1/24 ipv6.method disabled connection.autoconnect-priority 999 connection.autoconnect yes
    nmcli connection up "$profile"
    runuser -u "$account" -- /usr/bin/python3 -Es "$runtime/firstboot.py" "$app/pi-settings.json"
    sleep 2
fi
/usr/bin/python3 -I "$runtime/pi_settings.py" apply "$app/pi-settings.json"
