# 통신 규약 v1

## 경로

브라우저는 PC 서버와 HTTP JSON으로 통신하고, PC 서버가 ESP32-S3의 HTTP API를 호출합니다. 브라우저에서 ESP32로 직접 CORS 요청하지 않습니다. 전용 내부 Wi-Fi와 예약 IPv4 주소를 전제로 합니다.

PC: 기본 3000 포트, X-Control-Key 헤더.
열차: 80 포트, X-Train-Key 헤더.
키는 현장 설정에만 저장하며 저장소에 커밋하지 않습니다.

## PC API

| 메서드·경로 | 용도 |
|---|---|
| GET /api/status | 두 열차 상태 및 반복·오류 상태 |
| GET /api/show | 저장된 시퀀스 |
| POST /api/show | 시퀀스 검증 및 원자적 파일 저장 |
| POST /api/home | 두 열차 원점 복귀 |
| POST /api/start | 저장한 설정으로 준비·시간 추정·예약 시작 |
| POST /api/stop | 반복 취소 및 두 열차 정지 |
| POST /api/blackout | LED만 끄는 래치, 이동·소리 유지 |
| POST /api/clear-fault | 정지 상태에서 원인 해소 후 오류 해제 |
| POST /api/trains/1/manual | 1번 수동 설정 |
| POST /api/trains/2/manual | 2번 수동 설정 |

수동 설정은 pwm, rampMs, projection, delayMs, durationMs, sound, volume, loop를 모두 포함합니다. 자동 운전이나 자동 반복 대기 중에는 먼저 전체 정지해야 합니다.

## 열차 API

GET /api/status 응답은 인증된 상태 조회를 통신 heartbeat로 사용합니다. PC는 500ms 간격으로 조회합니다.

POST /api/command 공통 필드:

| 필드 | 의미 |
|---|---|
| seq | 단조 증가 정수, 중복·이전 순번 거부 |
| op | stop / clear_fault / blackout / home / manual / prepare / arm |

모든 응답에 version=1, id=1 또는 2가 있습니다. PC는 설정한 장치 ID와 응답이 일치하는지 확인합니다. 잘못된 키는 401, 잘못된 동작·설정은 409입니다. 순번이 소비된 실패 명령은 같은 순번으로 재시도하지 않습니다.

### 수동 및 장면 설정

| 필드 | 범위·의미 |
|---|---|
| pwm | −60…60, 부호가 방향, 크기가 PWM % |
| rampMs | 100…60000ms, 현재 PWM에서 목표까지의 가감속 기준 시간 |
| projection | true / false |
| delayMs | 0…500ms, 필름 감지부터 점등까지 |
| durationMs | 1…200ms, LED 점등시간 |
| sound | 0 정지, 1 sound1.wav, 2 sound2.wav |
| volume | 0…100% |
| loop | 음원 반복 여부 |

정·역 방향 전환은 PWM=0까지 감속한 뒤 추가 250ms 대기하고 방향을 바꿉니다. 따라서 전체 전환시간에는 이 대기가 더해집니다. 필름 센서와 투사면의 기하학적 관계가 역방향에서 달라지므로 역방향 LED 지연은 실물로 다시 설정해야 합니다.

prepare에는 runId와 profile이 들어갑니다. profile.version=1, profile.stages는 최대 12개입니다. 각 장면은 위 필드에 **holdMs**를 추가합니다. holdMs는 장면 유지시간(100…600000ms)이며 **durationMs는 LED 점등시간**입니다. 웹 저장 형식의 장면 durationMs와 열차 명령의 holdMs를 변환하는 함수는 profileFor입니다.

### 준비와 시작

1. 두 열차가 idle, homed=true, homeActive=true인지 확인.
2. 같은 runId로 prepare를 전달.
3. status 왕복 시간을 세 번 측정, 가장 작은 RTT의 중간 시각으로 PC와 보드의 단조 시계 차이를 추정.
4. 최저 RTT가 250ms보다 크면 시작 거부.
5. 약 4초 후의 시작 시각을 각 보드 uptimeMs로 환산하여 arm 전달.
6. 두 장치의 armed 응답과 runId를 다시 확인.
7. 실패·취소되면 두 장치에 더 높은 seq의 stop을 전달.

Wi-Fi 명령은 원자적 동시 실행을 보장하지 않습니다. 위 절차는 실패 확률을 줄이는 초기 구현이며, 실제 시작 오차와 오디오 지연은 측정해야 합니다. 한 열차가 멈추고 다른 열차에 정지 패킷이 전달되지 않을 경우 해당 장치의 3초 감시 정지가 최종 보호 동작입니다.

실제 LED 센서 처리에는 네트워크가 개입하지 않습니다. 예약 지연과 점등 시간은 보드 내부에서 수행합니다.

### 실행과 반복

열차는 전달받은 장면을 RAM에서 실행하고 끝나면 원점으로 돌아갑니다. 원점 센서가 이미 활성화되어 있으면 표식을 빠져나간 뒤 다시 진입한 에지를 찾아 정지합니다. 이미 정상 원점 대기 중인 home 명령은 그 자리에서 대기합니다.

두 열차의 finishedRunId가 현재 회차와 일치하고 homed=true이면 회차가 완료됩니다. PC는 설정한 waitMs를 기다린 뒤 다시 준비합니다. 따라서 반복 대기 외에 시작 준비 약 4초와 시퀀스의 암전 장면이 추가될 수 있습니다.

blackout은 현재 회차에서 다음 장면으로 넘어가도 LED가 다시 켜지지 않도록 래치됩니다. 다음 prepare 또는 명시적 수동 설정에서 해제됩니다. 소리만 있는 장면은 projection=false로 정의합니다.

## 오류와 한계

- LINK_TIMEOUT: active 상태에서 3초 이상 인증 heartbeat 없음.
- HOME_TIMEOUT: 원점 탐색 120초 초과.
- HOME_STUCK: 원점 표식을 3초 안에 벗어나지 못함.
- MANUAL_TIMEOUT: 수동 모드 10분 초과.
- MOTOR_FAULT: Pololu FLT 입력 활성.
- AUDIO_READ: 진행 중 파일 읽기 오류.
- ESTOP: 선택적 정지 접점 열림.

AUTO_HOME_ON_BOOT는 통신 lease 예외로 원점 복귀만 허용하며, 원점 timeout과 드라이버/정지 접점은 계속 적용합니다.

하드웨어 타이머는 100µs마다 LED 마감 시각을 검사합니다. 이 값은 실제 광학 응답이나 최악 지터의 보장값이 아닙니다. Wi-Fi, 플래시, 전원 조건에서 오실로스코프로 감지→점등 및 점등 폭을 측정해야 합니다.

필름 이벤트가 이전 지연/점등 처리 중 들어오면 큐에 무한히 쌓지 않고 누락 카운터를 올립니다. delayMs + durationMs가 필름 간격보다 길어지는 조건을 조정해야 합니다.
