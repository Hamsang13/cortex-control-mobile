Quad Desk · Raspberry Pi Zero 2 WH / Windows
1. Raspberry Pi Imager로 microSD에 Raspberry Pi OS Lite 64-bit (Bookworm 이상)를 기록합니다.
   호스트 qc-pi, 사용자명 qcuser, 비밀번호, 국가 KR, 집의 2.4GHz Wi-Fi 및 SSH를 설정하세요.
2. 기록을 마친 카드를 Windows에 다시 꽂아 bootfs 드라이브 최상위에 qc-web.zip을 그대로 복사합니다.
3. 카드를 Pi에 꽂고 전원을 연결합니다. 같은 네트워크의 PC에서 ssh qcuser@qc-pi.local 로 접속합니다.
4. Pi에서 다음 두 줄을 실행합니다. 초기 설치에는 인터넷이 필요합니다.
   python3 -m zipfile -e /boot/firmware/qc-web.zip ~/qc-setup
   bash ~/qc-setup/install-pi.sh
5. 출력된 Wi-Fi 비밀번호와 #키 포함 URL을 기록한 뒤 sudo reboot 합니다.
   iPad에서 QC-Pedalboard에 연결하고 출력된 주소를 Safari에서 엽니다.
   쿼코는 기존 전원 사용. Pi USB → OTG → 쿼코 USB-B. Pi PWR IN에는 별도 5V 전원을 연결합니다.
6. GRID에서 블록을 탭하고 노브를 위아래로 드래그합니다. 길게 누르면 씬별 값 할당을 엽니다.
   프리셋 이름으로 My Presets를 열고 A-H로 씬을 바꿉니다. 저장은 대상 슬롯을 확인한 뒤 실행하세요.
7. 문제 확인: systemctl status qc-desk --no-pager / journalctl -u qc-desk -n 40 / lsusb
   USB 접근 거부 시 Pi의 데이터 단자에 장치를 다시 연결하세요. Linux에서 실기 검증 전입니다.
   집 Wi-Fi로 돌아가려면 AP로 연결한 뒤 ssh qcuser@10.42.0.1 로 로그인하여
   sudo nmcli connection modify QC-Pedalboard connection.autoconnect no
   sudo reboot
Windows: 기존 qc-test 가상환경에서 python.exe로 server.py 실행, 출력된 #키 포함 주소 사용.
하드웨어가 없는 데모: python server.py --demo

하단 TEMPO에서 프리셋 BPM과 메트로놈을 조정합니다. Global 탭은 조회용입니다.
행 그룹별 CPU 사용률은 블록별 DSP 비용으로 추정합니다. 전체 사용률은 본체 값이 있으면 그대로 표시하고, 없으면 모델별 DSP 비용으로 계산합니다.
TUNER는 본체에서 USB HID로 보내는 음정을 표시합니다. 본체 입력과 튜닝 중 Mute를 변경할 수 있고 Reference는 웹 튜너 표시에 적용됩니다.

상단 화살표로 본체의 편집을 취소하거나 다시 실행합니다. 오른쪽 볼륨 노브를 위아래로 끌어 마스터 볼륨을 조절합니다.
입출력 블록을 누르면 왼쪽에서 포트를 선택할 수 있습니다. 그리드 선을 길게 누르면 S/M 핸들과 하단 Splitter·Mixer 편집기가 열립니다.
