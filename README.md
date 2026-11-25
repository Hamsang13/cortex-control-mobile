# Quad Desk

iPad Safari에서 Quad Cortex를 편집하는 로컬 웹 앱입니다. Windows 또는 Raspberry Pi Zero 2 WH가 USB를 담당하고 React 화면은 iPad에서 실행됩니다.

## Raspberry Pi와 iPad 연결

Quad Cortex와 Pi는 USB로 연결하고, iPad는 Wi-Fi로 Pi에 접속합니다. 최초 설치에는 인터넷이 필요합니다. 설치 후에는 Pi가 공연용 Wi-Fi를 열고 편집기 서버를 자동으로 시작합니다.

1. Raspberry Pi OS Lite 64-bit를 기록한 microSD에 설치 ZIP을 복사합니다. Pi에서 ZIP을 풀고 일반 사용자로 `bash install-pi.sh`를 실행합니다. 출력된 Wi-Fi 비밀번호와 `#키`가 포함된 Safari 주소를 저장한 뒤 재부팅합니다. [microSD 준비 및 SSH 설치 절차](README.txt)
2. Pi Zero 2 W의 **USB** 데이터 단자에 micro-USB OTG 어댑터를 꽂고 USB 케이블로 Quad Cortex의 USB-B 단자와 연결합니다. Pi의 **PWR IN**에는 별도 5V 전원을 연결하고 Quad Cortex도 자체 전원으로 켭니다.
3. iPad에서 **설정 → Wi-Fi → QC-Pedalboard**를 선택합니다. Safari에서 설치 때 저장한 주소(`http://10.42.0.1:8765/#키`)를 열면 됩니다. 상단 **USB 연결됨**은 Pi가 본체를 읽은 상태입니다. **USB 대기**일 때는 마지막으로 읽어 둔 목록을 보고, **USB 연결**을 눌러 편집을 시작할 수 있습니다.

## PC 실행과 데모

Python 3.11 이상에서 `python server.py --demo`를 실행하면 USB 없이 편집기를 사용할 수 있습니다. 실제 연결은 Cortex Control을 종료하고 `pyquadcortex==0.40.0`과 HIDAPI가 설치된 환경에서 `python server.py`를 실행합니다. Windows의 hidapi.dll 위치는 `QC_HID_DIR`로 지정할 수 있습니다. 터미널에 출력된 키 포함 URL로 접속하세요.

## 조작

- 프리셋 이름 또는 DIRECTORY에서 My Presets를 뱅크·이름으로 찾습니다. 화살표는 점유된 인접 슬롯으로 이동합니다. 저장 버튼에서 대상 슬롯을 선택할 수 있습니다.
- A–H는 본체 씬을 전환합니다. GIG VIEW는 그리드 아래에 4×2 씬 패널을 표시합니다. 각 타일은 본체의 씬 색과 이름을 사용하며 이름이 비어 있는 기본 씬은 Default scene으로 표시합니다. 풋스위치로 변경한 상태도 편집기에서 주기적으로 다시 읽습니다.
- 블록을 탭하면 라이브러리와 하단 파라미터가 해당 모델로 바뀝니다. 노브를 위아래로 드래그하거나 꾹 눌러 씬 할당을 변경합니다. 노브는 키보드 방향키로 조정하고 Enter로 씬 할당을 엽니다. Tremolo의 WAVEFORM은 현재 값이 강조된 선택 목록, SYNC는 세로 토글, SYNC NOTE는 단계식 노브로 표시됩니다. 선택 목록과 토글도 길게 눌러 씬별 값을 할당할 수 있습니다.
- 모델을 슬롯으로 끌어 추가·교체하고 블록을 끌어 이동합니다. 터치로는 대상 슬롯과 모델을 차례로 눌러도 됩니다. 블록의 ×로 삭제하고 ↶·↷로 본체의 실행 기록을 되돌리거나 다시 적용합니다.
- 행 양 끝의 포트 버튼에서 입출력을 선택합니다. 첫째·셋째 행에서는 분기·병합 열을 설정하거나 분기를 제거할 수 있습니다.
- 숫자 파라미터와 옵션은 장치 카탈로그에서 읽습니다. 변환 범위가 없는 파라미터는 정규화된 비율로 표시합니다. NEURAL CAPTURE의 FOLDER에서 본체 폴더를 탐색하고 LIBRARY에서 캡처 이름·작성자를 검색합니다. 고정 캡처가 먼저 표시되며 스크롤하면 다음 항목이 자동으로 나타납니다. 플러그인 모델은 PLUGINS에서만 표시됩니다. 제품을 누르면 종류별로 정렬된 모델 목록이 바로 아래에 펼쳐집니다. 보유 여부는 원본 앱에서 마지막으로 확인한 분류입니다. IR 파일 선택은 아직 제공하지 않습니다.
- Cortex Control을 사용할 때는 Quad Desk의 USB 해제를 누르세요. 마지막으로 읽은 목록은 USB 없이도 열립니다. 처음부터 목록만 보려면 `python server.py --browse`로 시작합니다. 웹에서 본체를 편집할 때는 Cortex Control을 닫고 USB 연결을 누릅니다.

## 하단 도구

- **CPU**를 누르면 그리드에 블록별 DSP 사용량을 표시합니다. 전체 수치 앞의 `≈`는 본체의 모델별 DSP 비용으로 계산한 추정값입니다.
- **TEMPO**에서 프리셋 BPM, 탭 템포, 메트로놈 설정을 조정합니다. Global 탭은 조회용입니다.
- **TUNER**에서 Quad Cortex의 USB 녹음 채널을 선택하면 음정과 센트를 표시합니다. 기준음은 웹 튜너에 적용되고 Mute는 본체 설정을 표시합니다. Windows에서는 서버 가상환경에 `sounddevice`와 `numpy`를 설치하세요.

## 빌드 및 설치 ZIP 생성

웹 화면을 수정한 뒤 저장소 루트에서 `npm ci`와 `npm run build`를 실행하면 배포용 `app.js`가 갱신됩니다. 빌드된 번들은 저장소에 포함되어 있어 Pi에서 바로 설치할 수 있습니다. PC에서 다음 명령으로 microSD에 복사할 ZIP을 만드세요.

```sh
python -m zipfile -c qc-web.zip server.py editor.py demo.py utilities.py pitch.py index.html app.js install-pi.sh README.txt
```

본체에서 읽은 프리셋·캡처 목록과 미리보기는 로컬 `.device-library/`에 저장됩니다. 새 설치에서는 본체를 연결해 목록을 읽으면 됩니다.

## 검증 범위

Windows에서 USB로 연결한 Quad Cortex의 프리셋 BPM과 Tremolo의 WAVEFORM·SYNC를 변경하고 본체에서 값을 다시 읽어 확인했습니다. Pi Zero 2 W와 iPad를 함께 사용한 실기 동작 및 공연 환경에서의 지연 시간은 아직 측정하지 않았습니다.

화면은 드래그 좌표를 로컬에서 처리합니다. 노브 전송은 직렬화하고 대기 중인 값은 최신 값으로 합칩니다. 전송 결과는 본체 상태를 다시 읽어 확인합니다. USB를 분리하거나 화면을 다시 열면 본체 상태로 재동기화합니다. Windows USB 왕복 시간과 Pi의 Wi-Fi 왕복 시간, 실제 오디오 지연은 서로 다른 측정값입니다.
