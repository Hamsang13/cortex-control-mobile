# 웹 블루투스 리모트 시험판

Windows Chrome에서 이 폴더의 `index.html`을 로컬 파일로 열거나 이 폴더를 localhost로 제공하세요. 배포하는 경우 웹 블루투스를 지원하는 브라우저와 신뢰된 HTTPS 출처가 필요합니다. iPad의 기본 Chrome은 이 BLE 실험에 필요한 Web Bluetooth API를 제공하지 않습니다. iPad에서 기존 Wi-Fi 리모트는 계속 사용할 수 있습니다.

**Pi 연결 → Cortex Remote 선택 → 기존 웹 접속 키 입력 → 응답 확인** 순서로 검사합니다. 응답 확인은 본체 상태를 바꾸지 않습니다. 씬 A~H 버튼은 USB로 연결된 본체에 실제 전환을 요청하며, 요청한 씬을 본체가 확인한 경우에만 성공을 표시합니다. 오디오는 USB/Bluetooth 시험에 포함되지 않습니다.

Pi 쪽은 BlueZ의 GATT 서비스와 광고 기능, Python 3, 시험용 Python 패키지 `dbus-next==0.2.3`을 사용합니다. 리모트 서비스와 같은 사용자로 `QC_PI_CONFIG`를 기존 pi-settings.json 경로로 설정한 뒤 `python3 bridge.py`를 실행합니다. 시스템 블루투스 전원이 켜져 있어야 합니다. 시험 페이지에는 키를 저장하지 않으며, 일회용 난수와 HMAC으로 요청과 응답을 검증합니다. 이 서비스는 v1.0.0 SD 이미지·업데이트 ZIP의 기본 설치 항목에서 제외됩니다.

현장 시험용 임시 서비스를 종료할 때는 Pi에서 `sudo systemctl stop cortex-ble-test cortex-ble-test-web`을 실행하세요. 임시 서비스는 재부팅 시 자동 시작되지 않습니다.
