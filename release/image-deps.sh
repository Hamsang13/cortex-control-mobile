#!/bin/bash
set -euo pipefail
root=${1:?mounted image}
app=/var/lib/cortex-remote
# Do not start daemons in the build chroot, or copy host networking into the image.
saved=$(mktemp -d)
cp -a "$root/etc/resolv.conf" "$saved/resolv.conf"
if [[ -e "$root/usr/sbin/policy-rc.d" ]]; then cp -a "$root/usr/sbin/policy-rc.d" "$saved/policy"; fi
cleanup() {
    rm -f "$root/etc/resolv.conf" "$root/usr/sbin/policy-rc.d"
    cp -a "$saved/resolv.conf" "$root/etc/resolv.conf"
    if [[ -e "$saved/policy" ]]; then cp -a "$saved/policy" "$root/usr/sbin/policy-rc.d"; fi
    umount "$root/proc"; umount "$root/dev"; rm -r "$saved"
}
mount --bind /dev "$root/dev"
mount -t proc proc "$root/proc"
trap cleanup EXIT
rm -f "$root/etc/resolv.conf"
cp -L /etc/resolv.conf "$root/etc/resolv.conf"
printf '#!/bin/sh\nexit 101\n' > "$root/usr/sbin/policy-rc.d"
chmod 755 "$root/usr/sbin/policy-rc.d"
chroot "$root" env DEBIAN_FRONTEND=noninteractive bash -eu -c '
apt-get update
apt-get install -y --no-install-recommends python3-venv libhidapi-hidraw0 network-manager dnsmasq-base openssl rfkill
apt-get clean
mkdir -p /var/lib/cortex-remote
python3 -m venv /var/lib/cortex-remote/venv
/var/lib/cortex-remote/venv/bin/pip install --index-url https://pypi.org/simple --no-cache-dir pyquadcortex==0.40.0 hid==1.0.9 protobuf==7.36.2
/var/lib/cortex-remote/venv/bin/python -c "import hid, pyquadcortex"
'
