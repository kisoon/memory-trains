#pragma once
// Copy to config.h (ignored by Git). Arduino-ESP32 3.3.0, ESP32S3 Dev Module.
// Pin map targets an ESP32-S3-DevKitC style board. Check YOUR module's pinout.
constexpr int TRAIN_ID = 1;
constexpr char WIFI_SSID[] = "YOUR_2_4_GHZ_WIFI";
constexpr char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";
constexpr char TRAIN_TOKEN[] = "REPLACE_WITH_AT_LEAST_24_RANDOM_CHARACTERS";
constexpr int MOTOR_PWM_PIN=4, MOTOR_DIR_PIN=5;
constexpr int MOTOR_SLEEP_PIN=15; // Pololu G2 SLP. Set -1 for Cytron MD13S.
constexpr int MOTOR_FAULT_PIN=7; // Pololu FLT + external 10k to 3.3V. -1 for MD13S.
constexpr int LED_PIN=6;         // 3.3V gate/enable signal, NEVER 12V directly.
constexpr int FILM_PIN=8, HOME_PIN=9, WHEEL_PIN=10;
constexpr bool FILM_ACTIVE_LOW=false, HOME_ACTIVE_LOW=false; // raw TCST2103 collector
constexpr int SD_CS_PIN=11, SD_MOSI_PIN=12, SD_SCK_PIN=13, SD_MISO_PIN=14;
constexpr int I2S_BCLK_PIN=18, I2S_LRCLK_PIN=21, I2S_DOUT_PIN=47, AMP_SD_PIN=16;
constexpr int ESTOP_PIN=-1; // Optional NC contact to GND, high=stop. E.g. GPIO17.
constexpr bool AUTO_HOME_ON_BOOT=false; // Enable only after bench commissioning.
constexpr bool MOTOR_INVERT=false;
constexpr int MAX_PWM=60, HOME_PWM=18, HOME_DIRECTION=1;
constexpr int WHEEL_PULSES_PER_REV=20; // FALLING edges, disk fitted directly to wheel axle.
constexpr uint32_t HOME_TIMEOUT_MS=120000, HOME_RELEASE_TIMEOUT_MS=3000;
constexpr uint32_t LINK_TIMEOUT_MS=3000, REVERSE_HOLD_MS=250;
constexpr uint32_t FILM_FILTER_US=2000, WHEEL_FILTER_US=150;
