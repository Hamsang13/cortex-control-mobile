#!/bin/bash
set -euo pipefail
root=${1:?mounted root}
zip=${2:?signed zip}
src=$(cd "$(dirname "$0")/.." && pwd)
stage="$root/tmp/cortex-image-build"
mkdir -p "$stage/release"
install -m644 "$src"/release/{package.py,updater.py,firstboot.py,update-public.pem,hotspot.sh,install-runtime.sh} "$stage/release/"
install -m644 "$zip" "$stage/update.zip"
chroot "$root" bash -eu -c '
cd /tmp/cortex-image-build
PYTHONPATH=release python3 -c "from pathlib import Path; from package import unpack; unpack(Path(\"update.zip\"),Path.cwd(),Path(\"release/update-public.pem\"))"
getent passwd cortex-remote >/dev/null || useradd --system --user-group --home-dir /var/lib/cortex-remote --shell /usr/sbin/nologin cortex-remote
bash release/install-runtime.sh cortex-remote /var/lib/cortex-remote image
usermod -L pi
systemctl mask ssh.service ssh.socket sshswitch.service userconfig.service
touch /etc/cloud/cloud-init.disabled
'
printf 'KR\n' > "$root/boot/firmware/cortex-country.txt"
rm -rf "$stage" "$root/root/.cache/pip" "$root/var/lib/apt/lists/"*
rm -f "$root"/etc/ssh/ssh_host_* "$root"/var/lib/systemd/random-seed
printf 'uninitialized\n' > "$root/etc/machine-id"
app="$root/var/lib/cortex-remote"
for private in pi-settings.json key wifi .device-library; do test ! -e "$app/$private"; done
test -z "$(find "$root/root/.ssh" "$root/home" -type f \( -name authorized_keys -o -name 'id_*' \) -print -quit)"
test -z "$(find "$root/etc/NetworkManager/system-connections" -type f -print -quit)"
chroot "$root" /var/lib/cortex-remote/venv/bin/python -c 'import hid,pyquadcortex; import importlib.util as u; assert not u.find_spec("numpy") and not u.find_spec("sounddevice")'
chroot "$root" systemctl is-enabled qc-desk qc-desk-hotspot
