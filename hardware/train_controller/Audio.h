#pragma once
#include <Arduino.h>
#include <SD.h>
#include <SPI.h>
#include <ESP_I2S.h>
#include <atomic>

namespace Audio {
constexpr uint32_t RATE=22050, DATA_BYTES=RATE*2*5;
struct Clip {uint32_t offset=0, size=0;bool valid=false;};
struct Request {int track;int volume;bool loop;uint32_t revision;};
portMUX_TYPE ampMux=portMUX_INITIALIZER_UNLOCKED;
uint32_t revision=0;
I2SClass output;
Clip clips[3];
QueueHandle_t requests=nullptr;
std::atomic<int> current{0}, error{0};
bool sdReady=false, i2sReady=false;
uint16_t le16(const uint8_t* p){return p[0]|uint16_t(p[1])<<8;}
uint32_t le32(const uint8_t* p){return p[0]|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
String filename(int track){return String("/sound")+track+".wav";}
Clip inspect(int track){
  Clip result;File file=SD.open(filename(track),FILE_READ);if(!file)return result;
  uint8_t head[12];if(file.read(head,12)!=12||memcmp(head,"RIFF",4)||memcmp(head+8,"WAVE",4))return result;
  const uint64_t end=uint64_t(le32(head+4))+8;
  if(end>file.size()||end<12)return result;
  bool fmt=false,data=false;uint64_t pos=12;
  while(pos+8<=end){
    if(!file.seek(uint32_t(pos)))return Clip{};
    uint8_t h[8];if(file.read(h,8)!=8)return Clip{};
    uint32_t size=le32(h+4);uint64_t next=pos+8+size+(size&1);
    if(next>end)return Clip{};
    if(!memcmp(h,"fmt ",4)){
      uint8_t b[16];if(size<16||file.read(b,16)!=16)return Clip{};
      fmt=le16(b)==1&&le16(b+2)==1&&le32(b+4)==RATE&&le32(b+8)==RATE*2&&le16(b+12)==2&&le16(b+14)==16;
      if(!fmt)return Clip{};
    } else if(!memcmp(h,"data",4)){
      if(data||size!=DATA_BYTES)return Clip{};
      result.offset=uint32_t(pos+8);result.size=size;data=true;
    }
    pos=next;
  }
  result.valid=fmt&&data;
  return result;
}
const char* errorMessage(){
  switch(error.load()){case 1:return "SD 또는 WAV 확인 필요";case 2:return "I2S 초기화 실패";case 3:return "음원 읽기 실패";default:return "";}
}
void play(int track,int volume,bool loop){
  portENTER_CRITICAL(&ampMux);
  const uint32_t rev=++revision;digitalWrite(AMP_SD_PIN,LOW);
  portEXIT_CRITICAL(&ampMux);
  const Request r{track,volume,loop,rev};if(requests)xQueueOverwrite(requests,&r);
}
void task(void*){
  File file;Request state{0,0,false,0},next;uint32_t left=0;
  int16_t buffer[256];
  for(;;){
    if(xQueueReceive(requests,&next,0)==pdTRUE){
      digitalWrite(AMP_SD_PIN,LOW);if(file)file.close();state=next;current=0;left=0;
      if(state.track>0&&clips[state.track].valid){
        file=SD.open(filename(state.track),FILE_READ);
        if(!file||!file.seek(clips[state.track].offset)){error=3;state.track=0;}
        else {left=clips[state.track].size;current=state.track;error=0;}
      }
    }
    memset(buffer,0,sizeof(buffer));
    if(state.track&&file){
      if(left==0){
        if(state.loop&&file.seek(clips[state.track].offset))left=clips[state.track].size;
        else{state.track=0;current=0;file.close();digitalWrite(AMP_SD_PIN,LOW);}
      }
      if(left){
        const size_t count=std::min<size_t>(sizeof(buffer),left);
        const int n=file.read(reinterpret_cast<uint8_t*>(buffer),count);
        if(n!=int(count)){error=3;state.track=0;current=0;file.close();left=0;memset(buffer,0,sizeof(buffer));digitalWrite(AMP_SD_PIN,LOW);}
        else{
          left-=count;
          for(size_t i=0;i<count/2;i++)buffer[i]=int32_t(buffer[i])*state.volume/100;
          // A queued STOP must be handled before unmuting the amplifier.
          portENTER_CRITICAL(&ampMux);
          if(state.revision==revision)digitalWrite(AMP_SD_PIN,HIGH);
          portEXIT_CRITICAL(&ampMux);
        }
      }
    }
    if(i2sReady)output.write(reinterpret_cast<uint8_t*>(buffer),sizeof(buffer));
    else vTaskDelay(pdMS_TO_TICKS(10));
  }
}
bool available(int track){return track==0||(i2sReady&&track>=1&&track<=2&&clips[track].valid);}
void begin(){
  pinMode(AMP_SD_PIN,OUTPUT);digitalWrite(AMP_SD_PIN,LOW);
  requests=xQueueCreate(1,sizeof(Request));
  if(!requests){error=2;return;}
  SPI.begin(SD_SCK_PIN,SD_MISO_PIN,SD_MOSI_PIN,SD_CS_PIN);
  sdReady=SD.begin(SD_CS_PIN,SPI,10000000);
  if(sdReady){clips[1]=inspect(1);clips[2]=inspect(2);}
  if(!sdReady||!clips[1].valid||!clips[2].valid)error=1;
  output.setPins(I2S_BCLK_PIN,I2S_LRCLK_PIN,I2S_DOUT_PIN);
  i2sReady=output.begin(I2S_MODE_STD,RATE,I2S_DATA_BIT_WIDTH_16BIT,I2S_SLOT_MODE_MONO);
  if(!i2sReady)error=2;
  if(xTaskCreatePinnedToCore(task,"audio",6144,nullptr,2,nullptr,0)!=pdPASS){i2sReady=false;error=2;}
}
}
