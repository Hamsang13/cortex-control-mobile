# Cortex Control Mobile (Quad Desk)

아이패드 Safari에서 Quad Cortex의 현재 프리셋을 USB로 편집하는 독립 프로젝트입니다. 서버는 Windows 또는 Raspberry Pi Zero 2 WH에서 실행합니다. 씬 전환은 본체 풋스위치에서 합니다.

## 개발 시작

Python 3.11 이상에서 `python server.py --demo`를 실행하고 터미널에 표시된 키 포함 주소를 여세요. 데모에는 외부 패키지가 필요 없습니다. 실제 장치는 `pyquadcortex==0.40.0`과 HIDAPI가 필요합니다. Windows에서는 Cortex Control을 종료하고 x64 hidapi.dll 폴더를 QC_HID_DIR로 지정한 후 `python server.py`를 실행하세요. Pi 설치 및 Wi-Fi 설정은 [설치 안내](README.txt)를 참고하세요.

## 이어서 작업할 내용

- server.py는 USB 연결을 재사용하며 현재 프리셋을 읽습니다. index.html은 4행 8열의 블록 선택과 씬 공통 노브 편집을 제공합니다.
- Windows에서 CorOS 4.1.1 버전 조회에 성공했습니다. 데모 값 변경은 확인했지만 실제 노브 쓰기와 Pi 자동 시작은 검증 전입니다.
- 첫 실기 점검은 테스트 프리셋의 공통 노브 하나를 바꾼 뒤 웹 재조회 값과 본체 화면, 실제 소리를 비교하는 것입니다. 영구 저장은 본체에서 합니다.
- 편집 중 본체에서 프리셋을 바꾸면 USB 요청 사이에 경합할 수 있습니다. 실기 검증 시 프리셋 변경과 편집을 순서대로 진행하세요.
- 분기 배선, 블록 추가·삭제·이동, 씬별 값 편집은 미구현입니다.
