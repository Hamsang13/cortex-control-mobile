# Bluetooth로 기존 리모트 사용하기

**설정 → 연결 방식**에서 Wi-Fi와 Bluetooth를 선택합니다. 두 방식 모두 같은 그리드, 디렉토리, 파라미터 에디터, Gig View를 엽니다. Pi가 기존 리모트 서버를 실행하고 Quad Cortex와 USB로 통신합니다. iPad는 일반 인터넷 Wi-Fi를 유지할 수 있습니다.

## Pi와 iPad 준비

1. Pi에서 기존 Cortex Remote 서버를 실행합니다. BLE 브리지는 같은 버전의 `bridge.py`와 `remote_rpc.py`를 같은 폴더에 두고 실행합니다. 예전 씬 전용 브리지를 사용 중이면 그 프로세스를 종료하고 교체하세요. 이 브리지는 아직 배포 이미지의 자동 시작 서비스에 포함되지 않습니다.
2. Pi에는 BlueZ, Python 3, `dbus-next==0.2.3`과 `cryptography`가 필요합니다. 후자는 AES-GCM 요청과 응답을 처리합니다. Raspberry Pi OS에서는 시스템 Python용 `python3-cryptography`를 사용할 수 있습니다. 두 라이브러리를 같은 Python 환경에서 import할 수 있어야 합니다.
3. 블루투스를 켜고 기존 리모트 서비스와 같은 사용자로 `QC_PI_CONFIG`에 실제 pi-settings.json 경로를 지정한 뒤 `python3 bridge.py`를 실행합니다. Pi 설정의 접속 키와 포트가 실행 중인 서버와 일치해야 합니다.
4. 같은 커밋의 `source/index.html`과 `source/app.js`만 신뢰하는 HTTPS 서버의 같은 폴더에 둡니다. 키와 Pi 설정 파일은 Pi에 보관합니다. iPad의 [Bluefy](https://apps.apple.com/kr/app/bluefy-web-ble-browser/id1492822055)에서 그 폴더의 `index.html?transport=ble`을 여세요. 평소 리모트의 설정에서 Bluetooth를 선택해 해당 HTTPS 주소를 입력해도 됩니다. iPad의 일반 Chrome에서는 Wi-Fi 방식을 사용하세요.
5. 기존 웹 접속 키를 입력하고 **Pi 연결 → Cortex Remote**를 선택합니다. Pi 인증은 USB 없이 가능하며, 연결되면 기존 리모트 화면이 열립니다. 본체를 조작하려면 Pi와 Quad Cortex 사이에 USB 데이터 케이블이 필요합니다.
6. Wi-Fi로 돌아가려면 Pi 네트워크에 접속하고 설정에서 Wi-Fi를 선택한 뒤 키가 포함된 Pi 주소를 여세요. BLE 링크가 끊어지면 다시 인증합니다. 업데이트 ZIP 업로드와 재부팅 후 주소 자동 이동은 Wi-Fi에서 사용합니다.

브라우저가 각 요청을 암호화해 BLE로 전송하고 Pi 브리지가 로컬 JSON API로 전달합니다. 큰 응답은 나눠 읽고 브라우저가 지원하면 압축합니다. 프리셋과 씬 상태는 기존 서버에서 읽습니다. 편집 명령의 응답을 받기 전에 연결이 끊기면 재연결 후 상태를 확인하세요.

## 개발 검증

Node.js 22 이상, Python 3과 `cryptography`가 있는 환경에서 저장소 루트의 `node source/ble-test/test_transport.mjs`를 실행합니다. 모의 GATT 링크를 통해 실제 브라우저 전송 코드, Pi 브리지의 암호화·분할 처리, 로컬 데모 HTTP 서버를 함께 검증합니다. iPad의 실제 무선 지연과 처리량은 실기 확인이 필요합니다.

별도 `index.html`은 이전 씬 전용 진단 페이지입니다. HMAC을 사용하는 기존 진단용 BLE 특성도 유지됩니다.
