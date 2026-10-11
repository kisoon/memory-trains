# Memory Trains — 기억을 따라

두 ESP32-S3 열차의 이동, 필름 LED 투사, 5초 I2S 음원을 내부 Wi-Fi 웹페이지에서 제어하는 전시용 초기 개발 프로젝트입니다.

> v0.1 시제품입니다. 웹 테스트 11개와 ESP32-S3 컴파일을 통과했습니다. 실제 모터·LED·보드에서 검증하기 전 전시 운용용으로 간주하지 마세요.
> 현재 확인된 사항/미검증 항목은 [검증 기록](docs/validation.md)을 읽어 주세요.

## 폴더

| 폴더 | 내용 |
|---|---|
| web/ | Node.js 제어 서버, 한국어 반응형 웹 UI, 가상 열차, 테스트 |
| hardware/train_controller/ | Arduino ESP32-S3 펌웨어 |
| config/ | 공개 예시 및 Git에서 제외되는 현장 설정 |
| tools/ | 설정 생성, 업로드 대상 선택, 시험 음원 생성 |
| docs/ | 부품·배선·통신 규약·현장 시험 |
| .github/workflows/ | 웹 테스트와 펌웨어 컴파일 |

## 1차 구현 범위

- 열차별 방향·PWM·가감속·LED 지연·점등시간·음원·음량 조정
- 최대 12개 장면 편집, 순서 변경, 저장·불러오기
- 원점 복귀, 두 열차 준비 확인, 예약 시작
- 마지막 장면 후 두 열차 모두 원점에 도착하면 다음 회차 대기
- 영상만 암전: 모터와 소리는 계속 실행
- microSD의 sound1.wav / sound2.wav, 22050 Hz / 16-bit PCM / mono / 정확히 5초
- 필름 LED: 센서 인터럽트 + 100µs 간격 하드웨어 타이머
- 바퀴 펄스 기반 RPM 표시 (단일 센서, 속도 크기만 측정)
- 통신 두절 3초, 원점 탐색 시간 초과, 드라이버 오류 시 정지
- 명령 순번으로 오래된 이동 명령 무시
- GPIO 출력부와 I2S·네트워크 태스크 분리

PWM은 실제 이동속도가 아닙니다. v0.1에는 PID 속도 유지, 두 열차 간 실제 거리 측정, 위치 동기화, 음원의 샘플 단위 동기화, 무선 음원 업로드, 일시정지 후 중간 재개가 없습니다.

## 구조

브라우저 → PC의 Node.js 서버 → 전용 공유기 → 각 ESP32-S3.

브라우저를 닫아도 PC 서버와 열차가 전시를 이어갑니다. 서버 종료나 장시간 통신 끊김은 열차의 3초 통신 감시 정지를 발생시킵니다. 인터넷은 필요하지 않습니다. GitHub Pages / 외부 사이트 호스팅은 이 로컬 제어 서버를 대체하지 않습니다.

웹 서버는 장면 설정을 디스크에 저장합니다. 각 열차에는 현재 회차를 RAM으로 전송합니다. 보드가 재부팅되면 다시 원점 확인과 명시적 시작이 필요합니다. 전시 장면을 플래시에 자동 저장하거나 정전 후 자동 출발하지 않습니다.

## PC 준비

Node.js 22 이상과 Arduino IDE가 필요합니다. 웹은 npm 외부 의존성이 없습니다.

프로젝트 루트에서:

`node tools/setup.mjs`

Wi-Fi와 두 열차의 IP를 입력합니다. 공유기에서 ESP32의 DHCP 주소를 예약하세요. USB 시리얼 모니터 115200에서 보드 IP를 확인할 수 있습니다. 실제 주소가 다르면 config/local.json의 해당 host를 수정합니다.

생성되는 현장 설정에는 Wi-Fi 비밀번호와 제어 키가 들어 있습니다. config/local.json, config/train-1.h, config/train-2.h, hardware/train_controller/config.h는 Git에 포함되지 않습니다.

`cd web`

`npm start`

PC 브라우저에서 http://localhost:3000 에 접속한 뒤 config/local.json의 controlKey를 입력합니다.

휴대전화 접속을 선택한 경우 동일 Wi-Fi에서 http://PC의내부IP:3000 으로 접속합니다. 전시장 내부망에서 사용하고 공유기 포트 포워딩으로 외부에 공개하지 않습니다. HTTP 기반이므로 통신 자체는 암호화되지 않습니다.

## 펌웨어 업로드

1. Arduino IDE 보드 매니저에서 **esp32 by Espressif Systems 3.3.0** 설치.
2. 라이브러리 매니저에서 **ArduinoJson 7.4.2** 설치.
3. [배선표](docs/hardware.md)를 본인의 ESP32-S3 보드 회로도와 대조.
4. 프로젝트 루트에서 `node tools/select-train.mjs 1` 실행.
5. hardware/train_controller/train_controller.ino 열기.
6. ESP32S3 Dev Module과 실제 보드의 Flash/PSRAM/USB 설정·포트를 선택해 업로드.
7. 두 번째 보드는 `node tools/select-train.mjs 2` 실행 후 업로드.

기본 핀맵은 DevKitC 계열 예시입니다. XIAO ESP32S3 등 다른 보드에는 같은 핀맵을 그대로 적용할 수 없습니다. 보드의 D번호가 아닌 GPIO 번호입니다.

기본 AUTO_HOME_ON_BOOT=false는 최초 배선 시험용입니다. 원점 감지·방향·정지 위치가 검증되면 각 config/train-N.h에서 true로 바꾸고 다시 select-train/업로드합니다. 이 경우 부팅 후 네트워크 연결 전에도 저속 원점 탐색을 수행하고 대기합니다.

모터 PWM 상한은 60%입니다. 샘플 속도와 LED 시간은 작품에 맞춘 확정값이 아니라 시험 출발값입니다. 모터가 움직이기 시작하는 최소 PWM, 바퀴 지름, 제동거리, 광학 정렬을 현장에서 보정해야 합니다.

## 5초 음원

권리 문제가 없는 본인 녹음을 22050 Hz / signed 16-bit PCM / mono / 5초 WAV로 변환한 뒤 FAT32 microSD 루트에 sound1.wav, sound2.wav로 복사합니다.

FFmpeg 예시:

`ffmpeg -i recording.wav -af apad -t 5 -ar 22050 -ac 1 -c:a pcm_s16le sound1.wav`

메타데이터가 포함된 WAV도 RIFF 청크를 읽어 처리합니다. 헤더를 무조건 44바이트로 가정하지 않습니다. 5초 PCM 데이터는 220,500바이트이며 WAV 전체 크기는 헤더와 메타데이터에 따라 다릅니다.

시험용으로 직접 생성한 두 톤은:

`python3 tools/make_test_audio.py audio`

실제 음원은 저장소에 포함하지 않습니다. 현재 재생은 장면마다 시작되며 장면 전환 시 앞 음원을 즉시 교체합니다. 교차 페이드가 없고 반복 경계에 최대 한 오디오 버퍼의 공백이 생길 수 있습니다. 허밍의 자연스러운 연결은 음원 편집과 실물 청취로 조정합니다.

## 하드웨어 없이 웹 시험

실제 운영 프로젝트와 다른 폴더에 복사한 뒤:

`node tools/setup.mjs --sim`

터미널 1: web 폴더에서 `npm run simulate`

터미널 2: web 폴더에서 `npm start`

제어 화면의 상태에는 **가상 열차**가 표시됩니다. 원점 복귀 후 전체 시작으로 흐름을 확인합니다. 시뮬레이터는 통신·상태 전이 검증용이며 모터 물리, 실제 LED, 소리를 재현하지 않습니다.

## 개발 검증

web 폴더에서 `npm test`.

[GitHub Actions 검증](https://github.com/kisoon/memory-trains/actions/runs/38147656172): Node.js 테스트 11개 통과, Arduino ESP32-S3 컴파일 성공. 컴파일 성공만으로 배선·부하·지연시간이 검증되지는 않습니다.

[부품과 배선](docs/hardware.md) · [통신 규약](docs/protocol.md) · [현장 시험](docs/commissioning.md) · [검증 기록](docs/validation.md)
