# Cortex Remote

코텍스 리모트(Cortex Remote)는 iPad·iPhone의 브라우저에서 Neural DSP Quad Cortex의 프리셋과 씬을 편집하는 비공식 웹 앱입니다. Windows PC 또는 Raspberry Pi가 USB로 본체와 통신하고, Safari는 로컬 네트워크를 통해 편집 화면을 표시합니다.

## 배포 파일 받기

**v1.0.0 공개 준비 중**

| 하려는 일 | 공개될 파일 |
| --- | --- |
| [새 SD 카드 설치](#install-sd) | `cortex-remote-v1.0.0-pi-zero2w-arm64.img.xz` |
| [기존 Pi 업데이트](#update-pi) | `cortex-remote-v1.0.0-update.zip` |

출시 후 이 표에서 설치 파일을 바로 받을 수 있습니다. 두 파일과 검증용 `SHA256SUMS`는 [GitHub Releases](https://github.com/Hamsang13/cortex-control-mobile/releases)에 함께 게시됩니다.

<a id="install-sd"></a>

## 처음 설치 · microSD 이미지

**Raspberry Pi Zero 2 W/WH**, 8GB 이상 microSD, 안정적인 5V 전원, USB OTG 어댑터와 Quad Cortex용 USB 데이터 케이블을 준비하세요. Mac과 Windows는 같은 이미지를 사용합니다.

1. 배포 파일 `cortex-remote-v1.0.0-pi-zero2w-arm64.img.xz`를 받습니다. `SHA256SUMS`와 대조할 때는 Mac에서 `shasum -a 256 파일명`, Windows PowerShell에서 `Get-FileHash 파일명 -Algorithm SHA256`을 사용하세요.
2. 컴퓨터의 카드 슬롯 또는 USB 카드 리더기에 microSD를 연결합니다. **기록하면 선택한 카드의 기존 데이터가 모두 지워집니다.** Raspberry Pi Imager에서 Zero 2 W → 운영체제 **사용자 이미지(Use custom)** → 다운로드한 `.img.xz` → 대상 카드를 선택하세요. OS 사용자 설정은 건너뛰고 기록과 검증이 끝날 때까지 기다립니다. XZ 압축 이미지를 지원하는 다른 SD 기록 도구도 사용할 수 있습니다. [Raspberry Pi Imager 공식 안내](https://www.raspberrypi.com/documentation/computers/imager.html)
3. 무선 국가 기본값은 한국(`KR`)입니다. 다른 국가에서 사용할 때는 기록된 카드의 **bootfs → cortex-country.txt**에 해당 두 자리 국가 코드를 저장합니다. 카드를 안전하게 꺼내 Pi에 넣습니다.
4. Quad Cortex에는 자체 전원을, Pi에는 **PWR IN**으로 5V를 공급합니다. Pi의 **USB** 데이터 단자와 Quad Cortex의 **USB-B**를 OTG 어댑터와 데이터 케이블로 연결하세요.
5. iPad의 Wi-Fi 목록에서 **Cortex-Remote-Setup**에 연결합니다. 최초 설정 전용 비밀번호는 **CortexSetup1**입니다. 가까이 있는 사용자가 먼저 등록할 수 있으므로 개인 공간에서 한 대씩 설정하세요. 인터넷이 없는 네트워크에 계속 연결한 상태로 Safari에서 **http://10.42.0.1:8765/** 를 엽니다.
6. 개인 핫스팟 이름, 비밀번호, 웹 접속 키가 제안됩니다. 그대로 사용하거나 직접 변경한 뒤 **저장하기 전에 세 값을 보관**하세요. 저장하면 설치용 Wi-Fi가 닫히고 개인 핫스팟이 올라옵니다. iPad에서 새 Wi-Fi에 연결한 뒤 설정 완료 화면의 **Cortex Remote 열기**를 누르고 즐겨찾기에 추가합니다. 직접 입력할 주소는 `http://10.42.0.1:8765/#접속키`입니다.

이미지에는 OS, 앱과 ARM64 USB 의존성이 들어 있습니다. 첫 부팅은 인터넷·SSH·터미널 없이 진행되며, 이후에는 개인 Wi-Fi와 앱이 자동으로 시작됩니다. 설치용 비밀번호는 공개값이고 개인 Wi-Fi 비밀번호와 접속 키는 각 카드의 최초 등록 때 결정됩니다. 이미지의 SSH 로그인은 꺼져 있습니다.

<a id="update-pi"></a>

## 설치 후 · Wi-Fi로 업데이트

1. 인터넷에 연결된 PC 또는 iPad에 `cortex-remote-v1.0.0-update.zip`을 미리 저장합니다. iPad에서는 파일 앱의 **나의 iPad** 등에 실제 다운로드를 완료하세요.
2. 해당 기기를 Pi의 개인 Wi-Fi에 연결하고 기존 즐겨찾기로 리모트를 엽니다.
3. 기기명 옆 **⚙ → Raspberry Pi → 오프라인 앱 업데이트**에서 받은 ZIP을 그대로 선택해 **업데이트 적용**을 누르세요. 적용 중에는 Pi 전원을 유지합니다.
4. 서명과 파일 해시가 맞으면 앱을 다시 시작하고 기동 확인 후 브라우저가 새로고침됩니다. 손상된 ZIP은 설치 전에 거부합니다. 후보 앱이 시작되지 않거나 기동 점검을 통과하지 못하면 직전 앱으로 복귀합니다. **Wi-Fi, 접속 키, 사용자 설정과 캐시는 유지**됩니다. 일반 앱 업데이트에는 Pi 재부팅이나 SD 카드 교체가 필요 없습니다.

Pi 자체의 Wi-Fi 이름·비밀번호·접속 URL·키를 변경할 때는 같은 설정 화면에서 저장 후 Pi를 재부팅하세요. 저장한 탭이 새 서버를 확인하면 이동합니다. Wi-Fi 정보가 바뀌면 iPad의 Wi-Fi 설정에서 새 네트워크에 먼저 연결하세요.

### iPad의 인터넷 연결과 Pi의 외부 Wi-Fi

| 현장 네트워크 | 연결 방법 |
| --- | --- |
| 공유기 또는 휴대폰 핫스팟 사용 가능 | Pi와 iPad를 같은 네트워크에 연결합니다. 인터넷은 공유기·휴대폰이 두 기기에 직접 제공합니다. 두 기기 사이의 통신이 허용돼야 Wi-Fi 리모트가 열립니다. |
| Pi 자체 핫스팟만 사용 | iPad에서 Pi를 직접 제어합니다. Pi에 인터넷 회선이 없으면 iPad에도 이 Wi-Fi를 통한 인터넷이 없습니다. |
| iPad가 다른 Wi-Fi에 계속 연결되어야 함 | Bluefy에서 BLE로 Pi를 제어합니다. Pi의 온라인 업데이트에는 Pi 자체의 인터넷 연결이 필요합니다. |
| iPad가 Pi 핫스팟에 붙은 채 인터넷도 사용 | Pi에 별도 인터넷 업링크와 인터넷 공유가 필요합니다. 내장 Wi-Fi 하나를 사용하는 현재 설정은 AP와 외부 Wi-Fi 접속 사이를 전환합니다. |

1. Pi 핫스팟에서 **설정 → Raspberry Pi → 외부 Wi-Fi**에 공유기 또는 휴대폰의 2.4GHz WPA2 네트워크 이름과 비밀번호를 입력합니다.
2. **이 Wi-Fi에 연결**을 누른 뒤 iPad도 같은 Wi-Fi로 옮깁니다. 화면에 표시된 Pi의 `.local` 주소로 이동합니다. 자동 이동이 어려우면 표시된 주소에 기존 `/#접속키`를 붙여 여세요.
3. **90초 안에 설정 → Raspberry Pi → 외부 Wi-Fi → 연결 유지**를 눌러 저장합니다. 확인하지 못하거나 외부 Wi-Fi가 끊어지면 Pi는 핫스팟 복구를 시도합니다. 게스트망·일부 휴대폰의 기기 간 격리 설정은 Wi-Fi 리모트 접속을 막을 수 있습니다.

### GitHub에서 앱 업데이트

배포자가 서명 업데이트 채널을 활성화한 뒤 사용할 수 있습니다. 처음 한 번은 이 기능을 포함한 서명 ZIP을 기존 앱에서 설치합니다. 이후 **설정 → Raspberry Pi**를 열면 Pi가 GitHub의 빌드를 확인합니다. **업데이트 설치**를 누르면 Pi가 ZIP을 받아 검증하고 앱을 재시작합니다. 같은 v1.0.0 내의 변경은 빌드 번호로 표시합니다. 인터넷이 없으면 기존 오프라인 ZIP 절차를 사용하세요. [배포 채널 설정과 BLE 최초 설치](source/release/README.md#github-서명-업데이트-채널)

### ZIP 업로드 메뉴 또는 네트워크 서비스가 없는 기존 Pi

기존 설치 계정으로 Pi를 인터넷에 연결하고 아래 절차를 **한 번만** 실행합니다. 기존 접속 정보를 유지하면서 업로드 기능과 복구용 실행기를 설치합니다. 이후부터 ZIP을 사용하세요.

```sh
cd ~/cortex-control-mobile
git pull --ff-only origin main
bash source/install-pi.sh
```

## 블루투스 웹 시험판

설정 → 연결 방식에서 Wi-Fi 또는 Bluetooth를 선택합니다. 두 방식 모두 같은 GRID, DIRECTORY, GIG VIEW와 파라미터 에디터를 사용합니다. iPad에서는 Bluefy에서 신뢰된 HTTPS 리모트 주소를 열고 Pi에 BLE로 연결합니다. Pi에는 같은 버전의 시험용 BLE 서비스가 필요합니다. [준비 및 검증 방법](source/ble-test/)

## 배포자 · 패키지 재생성

개발 소스는 [source/](source/)에 있습니다. [배포 빌드와 검증 절차](source/release/README.md)에 고정된 OS 원본, 서명 키 관리, ZIP 생성, 이미지 빌드, 가상 부팅 시험과 GitHub Releases 첨부 파일 목록이 있습니다.

## 사용 라이브러리

| 패키지 | 버전 | 역할 |
| --- | --- | --- |
| [pyquadcortex](https://github.com/stokes-audio/pyquadcortex) | 0.40.0 | Quad Cortex와 USB로 통신해 프리셋·씬·블록을 편집하고 본체 튜너가 측정한 음정(Hz)을 수신합니다. |
| hid | 1.0.9 | pyquadcortex가 USB 연결 시 hid.Device()를 호출합니다. Pi에서 로드하는 네이티브 라이브러리는 libhidapi-hidraw.so.0입니다. |
| protobuf | 7.36.2 | USB 통신 메시지를 직렬화·역직렬화합니다. 리모트의 I/O 설정 화면도 MessageToDict()로 본체 응답을 변환합니다. |
| [react, react-dom](https://github.com/facebook/react) | 각각 19.3.1 | 그리드, 파라미터 편집기, Gig View를 브라우저에 렌더링합니다. |

튜너 음정과 레벨 미터는 Quad Cortex가 측정한 값을 USB HID로 받아 표시합니다. 상단에는 아날로그 IN 1·2와 OUT 1~4를 각각 표시합니다. 그리드 포트 아래에서는 해당 라우팅의 레벨을 표시합니다. 여러 채널을 사용하는 포트는 가장 높은 레벨을 표시합니다.

배포자는 Python `cryptography`로 업데이트 ZIP에 서명하고, Pi는 이미지에 포함된 OpenSSL로 서명을 검증합니다. HTTP 서버는 Python 표준 라이브러리의 `http.server`를 사용합니다. 프런트엔드 번들 생성 도구는 [esbuild](https://github.com/evanw/esbuild) 0.28.2입니다.
