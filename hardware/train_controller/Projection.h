#pragma once
#include <Arduino.h>
namespace Projection{
portMUX_TYPE mux=portMUX_INITIALIZER_UNLOCKED;
volatile bool enabled=false,pending=false;
volatile uint32_t delayUs=20000,durationUs=10000,onAt=0,offAt=0,lastFilm=0;
volatile uint32_t filmCount=0,missedCount=0,wheelCount=0,wheelAt=0,wheelPeriod=0;
hw_timer_t* timer=nullptr;
void ARDUINO_ISR_ATTR filmISR(){
  const uint32_t now=micros();portENTER_CRITICAL_ISR(&mux);
  if(uint32_t(now-lastFilm)>=FILM_FILTER_US){
    lastFilm=now;filmCount++;
    if(enabled){
      if(pending)missedCount++;
      else{onAt=now+delayUs;offAt=onAt+durationUs;pending=true;}
    }
  }
  portEXIT_CRITICAL_ISR(&mux);
}
void ARDUINO_ISR_ATTR wheelISR(){
  const uint32_t now=micros();portENTER_CRITICAL_ISR(&mux);
  if(uint32_t(now-wheelAt)>=WHEEL_FILTER_US){
    if(wheelAt)wheelPeriod=now-wheelAt;wheelAt=now;wheelCount++;
  }
  portEXIT_CRITICAL_ISR(&mux);
}
void ARDUINO_ISR_ATTR timerISR(){
  const uint32_t now=micros();portENTER_CRITICAL_ISR(&mux);
  if(!enabled){digitalWrite(LED_PIN,LOW);pending=false;}
  else if(pending){
    if(int32_t(now-offAt)>=0){digitalWrite(LED_PIN,LOW);pending=false;}
    else if(int32_t(now-onAt)>=0)digitalWrite(LED_PIN,HIGH);
  }
  portEXIT_CRITICAL_ISR(&mux);
}
void configure(bool on,uint32_t delayMs,uint32_t durationMs){
  portENTER_CRITICAL(&mux);enabled=on;pending=false;digitalWrite(LED_PIN,LOW);
  delayUs=delayMs*1000;durationUs=durationMs*1000;portEXIT_CRITICAL(&mux);
}
struct Stats{uint32_t film,missed,wheel;float rpm;};
Stats stats(){
  portENTER_CRITICAL(&mux);
  const uint32_t period=wheelPeriod,last=wheelAt,count=wheelCount;
  Stats s{filmCount,missedCount,count,0};portEXIT_CRITICAL(&mux);
  if(count>=2&&period&&uint32_t(micros()-last)<3000000)
    s.rpm=60000000.0f/(WHEEL_PULSES_PER_REV*period);
  return s;
}
bool begin(){
  pinMode(LED_PIN,OUTPUT);digitalWrite(LED_PIN,LOW);
  pinMode(FILM_PIN,INPUT_PULLUP);pinMode(WHEEL_PIN,INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FILM_PIN),filmISR,FILM_ACTIVE_LOW?FALLING:RISING);
  attachInterrupt(digitalPinToInterrupt(WHEEL_PIN),wheelISR,FALLING);
  timer=timerBegin(1000000);if(!timer)return false;
  timerAttachInterrupt(timer,timerISR);timerAlarm(timer,100,true,0);return true;
}
}
