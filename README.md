# Cortex Remote

코텍스 리모트(Cortex Remote)는 iPad·iPhone의 브라우저에서 Neural DSP Quad Cortex의 프리셋과 씬을 편집하는 비공식 웹 앱입니다. Windows PC 또는 Raspberry Pi가 USB로 본체와 통신하고, Safari는 로컬 네트워크를 통해 편집 화면을 표시합니다.

## Raspberry Pi 초기 설정

아래 절차는 **Raspberry Pi Zero 2 W/WH + Raspberry Pi OS Lite (64-bit)** 기준입니다. 최초 설치에는 인터넷이 필요합니다. 설치 후에는 Pi가 Wi-Fi 핫스팟을 열고 Cortex Remote가 부팅할 때마다 자동으로 실행됩니다.

### 1. microSD와 네트워크 준비

1. PC에서 Raspberry Pi Imager를 열고 기종으로 Zero 2 W, 운영체제로 Raspberry Pi OS Lite (64-bit)를 선택합니다. 설치 스크립트는 NetworkManager와 Python 3.11 이상을 사용하는 Bookworm 이상 버전을 대상으로 합니다.
2. Imager의 사용자 설정에서 호스트 이름, 사용자 이름, 비밀번호를 지정합니다. 아래 명령은 각각 `qc-pi`, `qcuser`를 예로 사용합니다.
3. 처음 설치할 장소의 **2.4GHz Wi-Fi**와 국가를 설정하고 SSH를 켭니다. microSD에 기록한 뒤 Pi에 꽂아 부팅합니다.
4. PC를 같은 네트워크에 연결하고 터미널에서 접속합니다. 이름으로 찾을 수 없으면 공유기에 표시된 Pi의 IP 주소를 사용하세요.

```sh
ssh qcuser@qc-pi.local
```

Imager 설정 화면은 [Raspberry Pi 공식 초기 설정 안내](https://www.raspberrypi.com/documentation/computers/getting-started.html)를 참고하세요.

### 2. Pi에 Cortex Remote 설치

SSH로 접속한 **Pi 터미널**에서 일반 사용자로 실행합니다. 저장소에 웹 앱 번들 `app.js`가 포함되어 있으므로 Pi에서는 Node.js 설치나 프런트엔드 빌드가 필요 없습니다.

```sh
sudo apt-get update
sudo apt-get install -y git
git clone --branch main --single-branch https://github.com/Hamsang13/cortex-control-mobile.git
cd cortex-control-mobile
bash install-pi.sh
```

스크립트가 USB HID 라이브러리, Python 가상환경, USB 접근 권한, `qc-desk.service`와 Wi-Fi 프로필 `QC-Pedalboard`를 구성합니다. 마지막에 출력되는 **Wi-Fi 비밀번호와 `#` 뒤의 접속 키까지 포함한 Safari 주소**를 기록한 뒤 재부팅합니다.

```sh
sudo reboot
```

### 3. Quad Cortex와 iPad 연결

1. Quad Cortex에 자체 전원을 공급합니다. Pi Zero 2 W/WH에는 **PWR IN**으로 5V 전원을 공급합니다.
2. Pi의 **USB** 데이터 단자에 Micro USB OTG 호스트 어댑터를 꽂고, USB 데이터 케이블로 Quad Cortex의 **USB-B** 단자와 연결합니다.
3. iPad 또는 iPhone의 Wi-Fi 설정에서 **QC-Pedalboard**를 선택하고 설치 시 출력된 Wi-Fi 비밀번호를 입력합니다. 인터넷 연결이 없는 로컬 Wi-Fi로 표시될 수 있습니다.
4. Safari에 설치 시 출력된 `http://10.42.0.1:8765/#접속키` 주소를 열고 즐겨찾기에 저장합니다. 상단에 본체 이름과 **USB 연결됨**이 표시되면 연결된 상태입니다.

### 접속 정보와 문제 확인

핫스팟에 연결한 PC에서는 `ssh qcuser@10.42.0.1`로 Pi에 접속할 수 있습니다. 다음 명령은 **설치한 사용자 계정의 Pi 터미널**에서 실행합니다.

```sh
# Wi-Fi 비밀번호와 Safari 접속 주소 다시 보기
python3 ~/.local/share/qc-desk/pi_settings.py show ~/.local/share/qc-desk/pi-settings.json

# 핫스팟, 서버, Quad Cortex USB 인식 확인
nmcli connection show --active
systemctl status qc-desk --no-pager
lsusb -d 152a:880a
journalctl -u qc-desk -b -n 40 --no-pager
```

`lsusb` 결과가 비어 있으면 Pi의 데이터 단자, OTG 어댑터, 케이블, Quad Cortex 전원을 확인합니다. Safari에서 페이지가 열리지만 접근이 거부되면 주소 끝의 `#접속키`까지 복사했는지 확인하세요. 접속 주소와 서비스 로그에는 키가 포함될 수 있습니다.

기기 이름 옆 톱니바퀴의 **Raspberry Pi** 항목에서 핫스팟 이름과 비밀번호, HTTP 접속 주소(사설 IPv4와 1024~65535 포트), 접속 키를 저장할 수 있습니다. 암호와 키를 비워 두면 기존 값을 유지합니다. 저장 후 Pi를 재부팅하고 새 Wi-Fi에서 `http://주소:포트/#접속키`로 접속합니다. 기존 설치는 아래 업데이트 절차를 한 번 진행하세요.

### 최신 main으로 업데이트

Pi를 인터넷에 연결한 뒤 기존 소스 디렉터리에서 다음을 실행합니다. 설치 스크립트를 다시 실행해도 기존 Wi-Fi 비밀번호와 Safari 접속 키는 유지됩니다.

```sh
cd ~/cortex-control-mobile
git pull --ff-only origin main
bash install-pi.sh
```

Zero 2 W의 Wi-Fi를 핫스팟에서 설치 때 사용한 공유기로 잠시 전환하려면 Pi에서 `nmcli connection show`로 집 Wi-Fi 프로필 이름을 확인하고 `sudo nmcli connection up "집 Wi-Fi 프로필 이름"`을 실행합니다. 핫스팟의 SSH 연결이 끊기면 PC도 집 Wi-Fi에 연결하고 `ssh qcuser@qc-pi.local`로 다시 접속합니다. 업데이트 후 `sudo reboot`하면 핫스팟이 자동으로 시작됩니다.

## 사용 라이브러리

| 패키지 | 버전 | 역할 |
| --- | --- | --- |
| [pyquadcortex](https://github.com/stokes-audio/pyquadcortex) | 0.40.0 | Quad Cortex와 USB로 통신해 프리셋·씬·블록을 편집하고 본체 튜너가 측정한 음정(Hz)을 수신합니다. |
| [react, react-dom](https://github.com/facebook/react) | 각각 19.3.1 | 그리드, 파라미터 편집기, Gig View를 브라우저에 렌더링합니다. |

튜너 음정과 레벨 미터는 Quad Cortex가 측정한 값을 USB HID로 받아 표시합니다. 상단에는 아날로그 IN 1·2와 OUT 1~4를 각각 표시합니다. 그리드 포트 아래에서는 해당 라우팅의 레벨을 표시합니다. 여러 채널을 사용하는 포트는 가장 높은 레벨을 표시합니다.

USB 통신에서 `pyquadcortex`는 `hid`와 네이티브 HIDAPI로 장치에 접근하고, `protobuf`로 메시지를 처리합니다. HTTP 서버는 Python 표준 라이브러리의 `http.server`를 사용합니다. 프런트엔드 번들 생성 도구는 [esbuild](https://github.com/evanw/esbuild) 0.28.2입니다.
