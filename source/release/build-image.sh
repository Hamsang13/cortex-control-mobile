#!/bin/bash
# Inside a disposable privileged Debian Linux builder; /out contains the signed ZIP.
set -euo pipefail
src=$(cd "$(dirname "$0")" && pwd)
out=${1:-/out}
zip="$out/cortex-remote-v0.5.3-update.zip"
test -s "$zip"
base=https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2026-10-06/2026-10-06-raspios-trixie-arm64-lite.img.xz
sha=483db18a48da399b5b7022ffae9a07bc6d99daab30e593aedac09b69ff422843
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl xz-utils fdisk e2fsprogs dosfstools qemu-user-static
tmp=$(mktemp -d)
cd "$tmp"
root="$tmp/root"
cleanup(){
    mountpoint -q "$root/boot/firmware" && umount "$root/boot/firmware" || true
    mountpoint -q "$root" && umount "$root" || true
    loop=$(losetup -j "$tmp/os.img" | cut -d: -f1)
    [[ -z "$loop" ]] || losetup -d "$loop"
}
trap cleanup EXIT
curl -fL --retry 3 "$base" -o base.xz
echo "$sha  base.xz" | sha256sum -c -
xz -dc base.xz > os.img
bash "$src/mount-image.sh" "$tmp/os.img" "$root"
chroot "$root" /bin/true || { echo 'Enable ARM64 binfmt emulation on the Linux host.' >&2; exit 1; }
bash "$src/image-deps.sh" "$root"
bash "$src/populate.sh" "$root" "$zip"
cleanup
trap - EXIT
if [[ ${TEST_BOOT:-0} == 1 ]]; then
    apt-get install -y --no-install-recommends qemu-system-arm device-tree-compiler
    bash "$src/test-boot.sh" "$tmp/os.img" "$zip"
fi
name=cortex-remote-v0.5.3-pi-zero2w-arm64.img.xz
xz -T4 -3 -c os.img > "$out/$name.partial"
xz -t "$out/$name.partial"
mv "$out/$name.partial" "$out/$name"
cd "$out"
sha256sum "$name" "$(basename "$zip")" > SHA256SUMS
