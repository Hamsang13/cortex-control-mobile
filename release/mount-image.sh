#!/bin/bash
# Run inside an isolated Linux builder, never against an SD card.
set -euo pipefail
img=$(realpath "${1:?image file}")
[[ -f "$img" && ! -b "$img" ]]
root=${2:?empty mount directory}
mkdir -p "$root"
[[ -z $(ls -A "$root") ]]
truncate -s +768M "$img"
echo ',+' | sfdisk --no-reread -N 2 "$img"
loop=$(losetup --find --show --partscan "$img")
echo "$loop" > /tmp/cortex-build-loop
for n in 1 2; do
    part="${loop}p$n"
    if [[ ! -b "$part" ]]; then
        IFS=: read -r major minor < "/sys/class/block/${part##*/}/dev"
        mknod "$part" b "$major" "$minor"
    fi
done
e2fsck -pf "${loop}p2" || [[ $? == 1 ]]
resize2fs "${loop}p2"
mount "${loop}p2" "$root"
mount "${loop}p1" "$root/boot/firmware"
