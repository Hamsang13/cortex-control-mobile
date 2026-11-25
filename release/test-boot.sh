#!/bin/bash
# Use only disposable copies. QEMU's BCM2837 model runs the ARM64 Pi kernel.
set -euo pipefail
base=$(realpath "$1")
zip=$(realpath "$2")
src=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
cd "$tmp"
cp --sparse=always "$base" test.img
truncate -s 4G test.img
loop=$(losetup --find --show --partscan test.img)
mkdir root
cleanup(){
    [[ -z ${pid:-} ]] || kill "$pid" 2>/dev/null || true
    mountpoint -q root/boot/firmware && umount root/boot/firmware || true
    mountpoint -q root && umount root || true
    losetup -d "$loop" 2>/dev/null || true
}
trap cleanup EXIT
for n in 1 2; do
    part="${loop}p$n"
    read -r number < "/sys/class/block/${part##*/}/dev"
    if [[ ! -b $part ]]; then mknod "$part" b "${number%:*}" "${number#*:}"; fi
done
mount "${loop}p2" root
mount "${loop}p1" root/boot/firmware
cp root/boot/firmware/{kernel8.img,initramfs8,bcm2710-rpi-3-b.dtb} .
install "$src/check-appliance.py" root/usr/local/bin/cortex-test
# /tmp is a tmpfs at boot.
install "$zip" root/var/tmp/cortex-test.zip
cat > root/etc/systemd/system/cortex-test.service <<'UNIT'
[Unit]
Description=Disposable Cortex image test
After=NetworkManager.service
[Service]
ExecStartPre=/bin/cp /var/tmp/cortex-test.zip /tmp/cortex-test.zip
ExecStart=/usr/bin/python3 /usr/local/bin/cortex-test
StandardOutput=journal+console
StandardError=journal+console
ExecStopPost=/bin/sh -c 'cat /boot/firmware/cortex-test.log > /dev/ttyAMA0; systemctl poweroff --no-block'
[Install]
WantedBy=multi-user.target
UNIT
ln -s ../cortex-test.service root/etc/systemd/system/multi-user.target.wants/cortex-test.service
umount root/boot/firmware root
gzip -dc kernel8.img > Image
# Firmware normally resolves overlay parameters before handing the DT to Linux.
fdtput -t s bcm2710-rpi-3-b.dtb /soc/watchdog@7e100000 status disabled
fdtput -t s bcm2710-rpi-3-b.dtb /aliases serial0 /soc/serial@7e201000
fdtput -t s bcm2710-rpi-3-b.dtb /soc/serial@7e201000/bluetooth status disabled
# Use a serial console and simulated WLAN; stock firmware normally supplies these boot arguments.
qemu-system-aarch64 -M raspi3b -kernel Image -dtb bcm2710-rpi-3-b.dtb -initrd initramfs8 \
    -append 'earlycon=pl011,mmio32,0x3f201000 console=ttyAMA0,115200 root=PARTUUID=27b94958-02 rootwait rw modules_load=mac80211_hwsim net.ifnames=0 systemd.default_standard_output=journal+console' \
    -drive if=sd,format=raw,file=test.img -nographic -monitor none -no-reboot > serial.log 2>&1 &
pid=$!
for _ in {1..300}; do
    if grep -q COMPLETE serial.log; then grep -E 'PASS |COMPLETE' serial.log; exit 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 2
done
tail -80 serial.log
echo "Test files: $tmp" >&2
exit 1
