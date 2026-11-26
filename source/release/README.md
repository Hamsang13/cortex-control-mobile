# Cortex Remote 패키지 만들기

대상은 Pi Zero 2 W/WH용 Raspberry Pi OS Lite arm64입니다. `build-image.sh`는 Raspberry Pi 공식 2026-10-06 Trixie 이미지를 내려받고 고정된 SHA-256을 확인합니다. OS 패키지는 빌드할 때 설치합니다. 카드에는 ARM64 venv와 미리 빌드한 웹 번들이 들어갑니다. 같은 레시피를 다시 실행할 수 있으며 Debian 패키지 저장소 시점, 파일시스템 시간과 UUID에 따라 이미지 체크섬은 달라질 수 있습니다.

## 1. 소스와 서명된 ZIP

저장소 루트에서 Node.js/npm, Python 3.11 이상, Python `cryptography`와 OpenSSL을 준비합니다.

```sh
npm --prefix source ci
npm --prefix source run build
mkdir -p dist/v0.0.1
python3 source/release/package.py /secure/cortex-update-ed25519.pem dist/v0.0.1/cortex-remote-v0.0.1-update.zip
```

공식 ZIP에는 `source/release/update-public.pem`에 대응하는 **오프라인 Ed25519 개인 키**가 필요합니다. 개인 키는 저장소·SD·ZIP·GitHub 릴리스에 넣지 마세요. 최초로 독립 배포판을 만들 때만 별도 키 쌍을 생성하고 **자신의 이미지에 들어갈** 공개 키를 바꿉니다. 공개 키가 다른 이미지는 해당 ZIP을 거부합니다.

```sh
umask 077
openssl genpkey -algorithm ED25519 -out /secure/cortex-update-ed25519.pem
openssl pkey -in /secure/cortex-update-ed25519.pem -pubout -out source/release/update-public.pem
```

패키지 버전은 `source/release/package.py`에서 정의합니다. 사전 배포본은 v0.0.1을 유지하며, v1.0.0은 정식 출시 시 사용합니다. 같은 버전의 여러 빌드는 서명된 manifest의 SHA-256으로 구분합니다. ZIP은 지정된 앱 파일만 포함합니다. OS, 파이썬 가상환경, 고정 실행기 또는 서명 키를 바꾸는 릴리스는 새 이미지나 설치 프로그램을 제공합니다.

## 2. 이미지와 가상 부팅 시험

Linux 또는 Docker Desktop의 Linux 컨테이너 엔진을 사용합니다. x86-64 Linux 빌더는 ARM64 binfmt/QEMU 사용자 모드가 활성화되어 있어야 합니다. 아래 명령을 **저장소 루트**에서 실행합니다. Linux 루프 장치와 마운트를 사용하므로 일회용 빌더 컨테이너가 필요합니다. 입력과 결과는 일반 이미지 파일이며 물리 SD 카드를 연결할 필요가 없습니다.

```sh
docker run --rm --privileged -e TEST_BOOT=1 \
  -v "$PWD/source:/src:ro" -v "$PWD/dist/v0.0.1:/out" debian:trixie-slim \
  bash /src/release/build-image.sh /out
```

`TEST_BOOT=1`은 배포 이미지의 **별도 복사본**에서 ARM64 Pi 커널과 systemd를 부팅합니다. QEMU의 BCM2837 모델과 Linux의 mac80211_hwsim 무선 장치를 사용해 초기 AP와 등록 화면을 열고, 개인 SSID 전환과 앱 API를 확인합니다. 이어 손상된 ZIP, 서명된 정상 ZIP, 기동에 실패하는 후보를 검사합니다. 이 과정의 설정·키·시험 캐시는 배포 이미지에 기록되지 않습니다. 실제 Zero 2 W/WH의 무선 칩, iPad Wi-Fi 연결, USB 케이블과 Quad Cortex는 별도 실기 확인 대상입니다.

## 휴대폰 핫스팟 서비스와 앱 업데이트

이미지의 `cortex-network.service`가 NetworkManager를 제어합니다. 앱은 기존의 일반 사용자로 실행되며 서명된 업데이트 ZIP에 포함되는 Python 서버 코드에서 다음 인터페이스를 사용할 수 있습니다. `/run/cortex-network/control.sock`은 앱 계정의 UID를 검사합니다. 한 연결에 UTF-8 JSON 요청 한 줄을 보내면 JSON 응답 한 줄을 돌려줍니다. 소켓이 없는 구버전에서는 기능을 숨깁니다.

| action | 요청 및 동작 |
| --- | --- |
| `status` | 프로토콜 버전 1, phase, Pi의 실제 호스트 이름(.local), 현재 전환 ticket을 반환합니다. |
| `scan` | wlan0에서 보이는 SSID 목록을 반환합니다. 스캔할 수 없는 환경에는 SSID 직접 입력도 제공합니다. |
| `join` | ssid와 password로 WPA2 후보를 준비하고 ticket을 반환합니다. 4초 뒤 wlan0 전환을 시작합니다. |
| `confirm` | 활성 후보에 재접속한 브라우저가 보낸 ticket을 확인한 뒤 다음 부팅에도 쓸 프로필을 저장합니다. |
| `forget` | 저장한 자동 연결 선택을 지우고 개인 AP로 돌아가 휴대폰 프로필을 삭제합니다. |

앱은 기존 웹 키 인증을 거친 요청을 중계합니다. 전환 전에 iPad에 새 Wi-Fi 이름과 접속 주소를 표시하세요. 포트는 현재 앱 설정에서 가져옵니다. 브라우저가 새 네트워크에서 실제로 앱에 접속한 뒤에만 confirm을 호출하세요. 서버 내부 폴링으로 확인하면 휴대폰의 기기 간 통신 차단을 감지할 수 없습니다. 기존 개인 AP 프로필은 별도로 보존합니다. 연결 실패, 90초 내 확인 누락, 확인 후 연결 끊김에는 해당 AP로 돌아옵니다. 다음 부팅에는 마지막 확인된 프로필로 한 번 다시 시도합니다.

## 3. GitHub Releases 첨부 파일

| 파일 | 용도 |
| --- | --- |
| `cortex-remote-v0.0.1-pi-zero2w-arm64.img.xz` | 새 SD 카드에 기록할 OS와 앱 |
| `cortex-remote-v0.0.1-update.zip` | 기존 설치의 설정 화면에서 적용할 서명된 오프라인 앱 업데이트 |
| `SHA256SUMS` | 내려받은 두 파일의 SHA-256 |

이미지 기본 무선 국가 코드는 KR이며 해외 사용자는 최초 부팅 전에 bootfs의 `cortex-country.txt`를 해당 국가 코드로 변경합니다. 처음 설치하는 사용자의 단계별 안내와 구버전의 1회 이전 절차는 [프로젝트 README](../../README.md)에 있습니다. 패키지 빌드는 GitHub 게시·태그 생성·실기 설치를 수행하지 않습니다.

릴리스 게시 후 루트 README의 배포 표에 각 파일의 GitHub Releases 다운로드 링크를 연결하고 공개 상태를 갱신합니다.

## GitHub 서명 업데이트 채널

기본 상태에서는 소스만 푸시합니다. 운영자가 온라인 배포를 승인하면 저장소 Actions 변수 `PI_UPDATE_CHANNEL=enabled`와 Actions secret `PI_UPDATE_SIGNING_PEM`을 구성합니다. secret은 설치된 Pi의 공개 키와 일치하는 Ed25519 PEM이어야 합니다. 기존 오프라인 키를 CI에 위탁할 수 없는 배포에서는 채널을 비활성 상태로 두고 오프라인 서명을 사용하세요. 다른 키로 전환하려면 먼저 Pi의 신뢰 키를 별도로 배포해야 합니다.

`Signed Pi application update`를 main에서 수동 실행하거나 이후 source 변경을 main으로 푸시하면 잠금 파일로 웹 앱을 빌드하고 서명된 ZIP과 latest.json을 공개 pi-updates 브랜치의 한 커밋에 올립니다. 저장소의 Actions 토큰에는 해당 브랜치 쓰기 권한이 필요합니다. GitHub Releases 게시나 Pages 활성화는 필요하지 않습니다. 첫 활성화 시 해당 채널의 update.zip을 기존 설정의 오프라인 업데이트에 한 번 사용하세요.

Pi의 기존 cortex-network.service가 외부 Wi-Fi 전환을 담당합니다. 구버전 helper에서 복구 AP 프로필이 다른 경우 새 소스의 release/phone_wifi.py로 helper를 먼저 갱신해야 합니다. 시스템 서비스 설치·교체는 일반 앱 업데이트 범위 밖입니다.

BLE를 함께 설치할 때에는 인터넷에 연결된 Pi에서 현재 qc-desk.service 사용자와 실제 설정 파일 경로를 지정합니다. 예를 들어 일반 설치 계정이라면 저장소 루트에서 다음을 실행합니다.

```sh
sudo bash source/release/install-ble.sh "$(id -un)" "$HOME/.local/share/qc-desk/pi-settings.json"
```

이 스크립트는 BlueZ, python3-dbus-next, python3-cryptography와 BLE 서비스를 설치합니다. iPad에서 여는 HTTPS 화면도 같은 버전의 웹 번들로 갱신하세요.

오프라인 설치에서는 Pi에 BlueZ, 시스템 Python의 cryptography와 venv가 준비되어 있을 때 세 번째 인자로 dbus_next-0.2.3-py3-none-any.whl의 절대 경로를 지정할 수 있습니다. 도우미 전용 가상환경에 설치하며 Pi가 핫스팟을 유지한 채로 진행됩니다.
