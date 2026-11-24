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
6. 본체에서 테스트 프리셋을 선택하고 웹에서 다시 읽기 → 블록 → 노브를 조절합니다.
   수치는 노브 이동 범위 비율입니다. 본체 노브와 소리를 확인한 뒤 필요한 경우 본체에서 저장하세요.
   프리셋/씬 이동은 풋스위치로 하고 프리셋 변경 후 다시 읽으세요. 파라미터 전송 중에는 본체 조작을 마칠 때까지 기다리세요.
7. 문제 확인: systemctl status qc-desk --no-pager / journalctl -u qc-desk -n 40 / lsusb
   USB 접근 거부 시 Pi의 데이터 단자에 장치를 다시 연결하세요. Linux에서 실기 검증 전입니다.
   집 Wi-Fi로 돌아가려면 AP로 연결한 뒤 ssh qcuser@10.42.0.1 로 로그인하여
   sudo nmcli connection modify QC-Pedalboard connection.autoconnect no
   sudo reboot
Windows: 기존 qc-test 가상환경에서 python.exe로 server.py 실행, 출력된 #키 포함 주소 사용.
하드웨어가 없는 데모: python server.py --demo

편집 화면: 4행 × 8열은 실제 블록 좌표입니다. 블록을 선택하고 슬라이더를 놓으면 USB로 전송합니다.
분기/병합 배선은 표시하지 않습니다. Windows 데모 모드는 --demo 옵션을 사용하세요.
