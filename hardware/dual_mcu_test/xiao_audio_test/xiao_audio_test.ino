#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include <driver/i2s.h>
// XIAO ESP32-S3, Arduino-ESP32 2.x legacy I2S driver API.
// WAV test file: /test.wav PCM16 mono 22050 Hz, 44 byte standard header.
constexpr int SD_CS=4, SD_SCK=7, SD_MISO=8, SD_MOSI=9;
constexpr int I2S_BCLK=1, I2S_WS=2, I2S_DOUT=5; // D4 avoids GPIO3 strap
constexpr int UART_RX=44, UART_TX=43;
HardwareSerial Link(1);
File wav;
bool playing=false;
char line[96]; size_t len=0;
void stopSound(){ if(wav) wav.close(); playing=false; i2s_zero_dma_buffer(I2S_NUM_0); }
bool startSound(){
 stopSound(); wav=SD.open("/test.wav",FILE_READ);
 if(!wav) return false;
 uint8_t h[44];
 if(wav.read(h,44)!=44 || memcmp(h,"RIFF",4)!=0 || memcmp(h+8,"WAVE",4)!=0 ||
    memcmp(h+12,"fmt ",4)!=0 || memcmp(h+36,"data",4)!=0 ||
    h[20]!=1 || h[21]!=0 || h[22]!=1 || h[23]!=0 || h[34]!=16 || h[35]!=0 ||
    h[24]!=0x22 || h[25]!=0x56 || h[26]!=0 || h[27]!=0) { stopSound(); return false; }
 playing=true; return true;
}
void command(const char* c){
 if(strcmp(c,"PING")==0) Link.println("PONG");
 else if(strcmp(c,"STATUS")==0) Link.println(playing?"STATUS,PLAYING":"STATUS,IDLE");
 else if(strcmp(c,"STOP")==0){stopSound();Link.println("ACK,STOP");}
 else if(strcmp(c,"PLAY")==0){Link.println(startSound()?"ACK,PLAY":"ERR,WAV");}
 else Link.println("ERR,CMD");
}
void setup(){
 Serial.begin(115200);
 Link.begin(115200,SERIAL_8N1,UART_RX,UART_TX);
 SPI.begin(SD_SCK,SD_MISO,SD_MOSI,SD_CS);
 bool ok=SD.begin(SD_CS,SPI,10000000);
 i2s_config_t cfg={};
 cfg.mode=(i2s_mode_t)(I2S_MODE_MASTER|I2S_MODE_TX);
 cfg.sample_rate=22050; cfg.bits_per_sample=I2S_BITS_PER_SAMPLE_16BIT;
 cfg.channel_format=I2S_CHANNEL_FMT_ONLY_LEFT;
 cfg.communication_format=I2S_COMM_FORMAT_STAND_I2S;
 cfg.intr_alloc_flags=0;cfg.dma_buf_count=8;cfg.dma_buf_len=256;cfg.use_apll=false;
 i2s_driver_install(I2S_NUM_0,&cfg,0,nullptr);
 i2s_pin_config_t pins={};
 pins.bck_io_num=I2S_BCLK;pins.ws_io_num=I2S_WS;pins.data_out_num=I2S_DOUT;pins.data_in_num=I2S_PIN_NO_CHANGE;
 i2s_set_pin(I2S_NUM_0,&pins);
 Link.println(ok?"READY,SD_OK":"READY,SD_FAIL");
}
void loop(){
 while(Link.available()){
  char c=Link.read();
  if(c=='\n'){line[len]=0; command(line);len=0;}
  else if(c!='\r'){if(len<sizeof(line)-1)line[len++]=c;else len=0;}
 }
 if(playing){
  uint8_t buf[512]; int n=wav.read(buf,sizeof(buf));
  if(n<=0){stopSound();Link.println("DONE");}
  else {size_t written=0;i2s_write(I2S_NUM_0,buf,n,&written,pdMS_TO_TICKS(25));}
 }
}
