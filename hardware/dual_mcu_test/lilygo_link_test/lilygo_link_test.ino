#include <Arduino.h>
#include <string.h>
// Dual-board UART smoke test. Motors deliberately disabled.
// LILYGO T-Display S3 (non-touch), Arduino-ESP32 3.x
constexpr int RX_AUDIO=44, TX_AUDIO=43;
HardwareSerial AudioLink(1);
char rx[96]; size_t used=0;
uint32_t lastPing=0, seq=0;
void sendAudio(const char* cmd) { AudioLink.print(cmd); AudioLink.print('\n'); Serial.print("TX "); Serial.println(cmd); }
void setup() {
  Serial.begin(115200);
  AudioLink.begin(115200, SERIAL_8N1, RX_AUDIO, TX_AUDIO);
  delay(300);
  Serial.println("LILYGO link test. Commands on USB console: PING, PLAY, STOP, STATUS");
}
void loop() {
  while (AudioLink.available()) {
    char c=AudioLink.read();
    if(c=='\n') { rx[used]=0; Serial.print("AUDIO: "); Serial.println(rx); used=0; }
    else if(c!='\r') { if(used<sizeof(rx)-1) rx[used++]=c; else used=0; }
  }
  while(Serial.available()) {
    String s=Serial.readStringUntil('\n'); s.trim(); s.toUpperCase();
    if(s=="PING"||s=="PLAY"||s=="STOP"||s=="STATUS") sendAudio(s.c_str());
  }
  if(millis()-lastPing>=2000) { lastPing=millis(); sendAudio("PING"); }
}
