# Cortex Remote 패키지 만들기

대상은 Pi Zero 2 W/WH용 Raspberry Pi OS Lite arm64입니다. `build-image.sh`는 Raspberry Pi 공식 2026-10-06 Trixie 이미지를 내려받고 고정된 SHA-256을 확인합니다. OS 패키지는 빌드할 때 설치합니다. 카드에는 ARM64 venv와 미리 빌드한 웹 번들이 들어갑니다. 같은 레시피를 다시 실행할 수 있으며 Debian 패키지 저장소 시점, 파일시스템 시간과 UUID에 따라 이미지 체크섬은 달라질 수 있습니다.

## 1. 소스와 서명된 ZIP

저장소 루트에서 Node.js/npm, Python 3.11 이상, Python `cryptography`와 OpenSSL을 준비합니다.

```sh
npm --prefix source ci
npm --prefix source run build
mkdir -p dist/v1.0.0
python3 source/release/package.py /secure/cortex-update-ed25519.pem dist/v1.0.0/cortex-remote-v1.0.0-update.zip
```

공식 ZIP에는 `source/release/update-public.pem`에 대응하는 **오프라인 Ed25519 개인 키**가 필요합니다. 개인 키는 저장소·SD·ZIP·GitHub 릴리스에 넣지 마세요. 최초로 독립 배포판을 만들 때만 별도 키 쌍을 생성하고 **자신의 이미지에 들어갈** 공개 키를 바꿉니다. 공개 키가 다른 이미지는 해당 ZIP을 거부합니다.

```sh
umask 077
openssl genpkey -algorithm ED25519 -out /secure/cortex-update-ed25519.pem
openssl pkey -in /secure/cortex-update-ed25519.pem -pubout -out source/release/update-public.pem
```

패키지 버전은 `source/release/package.py`에서 정의합니다. 사전 배포본은 v1.0.0을 유지합니다. 같은 버전의 여러 빌드는 서명된 manifest의 SHA-256으로 구분합니다. ZIP은 지정된 앱 파일만 포함합니다. OS, 파이썬 가상환경, 고정 실행기 또는 서명 키를 바꾸는 릴리스는 새 이미지나 설치 프로그램을 제공합니다.

## 2. 이미지와 가상 부팅 시험

Linux 또는 Docker Desktop의 Linux 컨테이너 엔진을 사용합니다. x86-64 Linux 빌더는 ARM64 binfmt/QEMU 사용자 모드가 활성화되어 있어야 합니다. 아래 명령을 **저장소 루트**에서 실행합니다. Linux 루프 장치와 마운트를 사용하므로 일회용 빌더 컨테이너가 필요합니다. 입력과 결과는 일반 이미지 파일이며 물리 SD 카드를 연결할 필요가 없습니다.

```sh
docker run --rm --privileged -e TEST_BOOT=1 \
  -v "$PWD/source:/src:ro" -v "$PWD/dist/v1.0.0:/out" debian:trixie-slim \
  bash /src/release/build-image.sh /out
```

`TEST_BOOT=1`은 배포 이미지의 **별도 복사본**에서 ARM64 Pi 커널과 systemd를 부팅합니다. QEMU의 BCM2837 모델과 Linux의 mac80211_hwsim 무선 장치를 사용해 초기 AP와 등록 화면을 열고, 개인 SSID 전환과 앱 API를 확인합니다. 이어 손상된 ZIP, 서명된 정상 ZIP, 기동에 실패하는 후보를 검사합니다. 이 과정의 설정·키·시험 캐시는 배포 이미지에 기록되지 않습니다. 실제 Zero 2 W/WH의 무선 칩, iPad Wi-Fi 연결, USB 케이블과 Quad Cortex는 별도 실기 확인 대상입니다.

## 3. GitHub Releases 첨부 파일

| 파일 | 용도 |
| --- | --- |
| `cortex-remote-v1.0.0-pi-zero2w-arm64.img.xz` | 새 SD 카드에 기록할 OS와 앱 |
| `cortex-remote-v1.0.0-update.zip` | 기존 설치의 설정 화면에서 적용할 서명된 오프라인 앱 업데이트 |
| `SHA256SUMS` | 내려받은 두 파일의 SHA-256 |

이미지 기본 무선 국가 코드는 KR이며 해외 사용자는 최초 부팅 전에 bootfs의 `cortex-country.txt`를 해당 국가 코드로 변경합니다. 처음 설치하는 사용자의 단계별 안내와 구버전의 1회 이전 절차는 [프로젝트 README](../../README.md)에 있습니다. 패키지 빌드는 GitHub 게시·태그 생성·실기 설치를 수행하지 않습니다.

릴리스 게시 후 루트 README의 배포 표에 각 파일의 GitHub Releases 다운로드 링크를 연결하고 공개 상태를 갱신합니다.
