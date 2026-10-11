#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <esp_timer.h>
#include <algorithm>
#include <atomic>
#include "config.h"
#include "Audio.h"
#include "Projection.h"

static_assert(TRAIN_ID==1||TRAIN_ID==2,"TRAIN_ID must be 1 or 2");
static_assert(MAX_PWM>0&&MAX_PWM<=60,"Commissioning PWM limit must be 1..60");
static_assert(WHEEL_PULSES_PER_REV>0,"PPR must be positive");
WebServer httpServer(80);
SemaphoreHandle_t controlMutex=nullptr;
std::atomic<uint32_t> lastHeartbeat{0};
bool projectionReady=false, pwmReady=false;
uint64_t uptimeMs(){return uint64_t(esp_timer_get_time()/1000);}
struct Lock {
  Lock(){xSemaphoreTake(controlMutex,portMAX_DELAY);}
  ~Lock(){xSemaphoreGive(controlMutex);}
};
struct Stage {
  uint32_t durationMs=1000,rampMs=2000,delayMs=20,ledMs=10;
  int pwm=0,sound=0,volume=30;
  bool projection=false,loop=false;
};
struct State {
  String mode="stopped",fault="",runId="",finishedRunId="";
  Stage stages[12];int count=0,index=-1;
  bool homed=false,blackout=false,homeCleared=false,finishAfterHome=false,bootHoming=false;
  bool homeRaw=false,homeStable=false;
  uint32_t homeChangedAt=0,homeBeganAt=0,lastTick=0,reverseUntil=0;
  uint64_t stageAt=0,armedAt=0,lastSeq=0;
  float pwm=0,target=0,slewPerMs=0.03f;
  int direction=1;uint32_t manualAt=0;
} state;
bool homeInput(){return digitalRead(HOME_PIN)==(HOME_ACTIVE_LOW?LOW:HIGH);}
bool interlock(){return ESTOP_PIN>=0&&digitalRead(ESTOP_PIN)==HIGH;}
bool driverFault(){return MOTOR_FAULT_PIN>=0&&digitalRead(MOTOR_FAULT_PIN)==LOW;}
void driverEnable(bool enabled){if(MOTOR_SLEEP_PIN>=0)digitalWrite(MOTOR_SLEEP_PIN,enabled?HIGH:LOW);}
void applyMotor(){
  const bool dirHigh=(state.direction>0)!=MOTOR_INVERT;
  digitalWrite(MOTOR_DIR_PIN,dirHigh?HIGH:LOW);
  ledcWrite(MOTOR_PWM_PIN,uint32_t(std::min<float>(MAX_PWM,fabsf(state.pwm))*1023/100));
}
void halt(const char* mode){
  state.pwm=state.target=0;state.reverseUntil=0;state.index=-1;
  state.mode=mode;state.homed=false;state.bootHoming=false;
  state.finishAfterHome=false;state.armedAt=0;
  Projection::configure(false,0,1);Audio::play(0,0,false);
  if(pwmReady)ledcWrite(MOTOR_PWM_PIN,0);
}
void fail(const char* message){
  halt("fault");state.fault=message;driverEnable(false);
}
void setTarget(float value,uint32_t rampMs){
  state.target=value;state.slewPerMs=std::max(0.00001f,fabsf(value-state.pwm)/rampMs);
  if(value!=0)state.homed=false;
}
void applyStage(const Stage& s){
  setTarget(s.pwm,s.rampMs);
  Projection::configure(s.projection&&!state.blackout,s.delayMs,s.ledMs);
  Audio::play(s.sound,s.volume,s.loop);
}
void beginHome(bool finish,bool boot=false){
  Projection::configure(false,0,1);Audio::play(0,0,false);state.blackout=true;
  state.mode="homing";state.homeCleared=!state.homeStable;state.homeBeganAt=millis();
  state.finishAfterHome=finish;state.bootHoming=boot;state.homed=false;
  driverEnable(true);setTarget(HOME_DIRECTION*HOME_PWM,1000);
}
bool range(JsonVariantConst v,int lo,int hi){return v.is<int>()&&v.as<int>()>=lo&&v.as<int>()<=hi;}
bool readStage(JsonObjectConst o,Stage& s,bool timed){
  if((timed&&!range(o["holdMs"],100,600000))||
     !range(o["pwm"],-MAX_PWM,MAX_PWM)||!range(o["rampMs"],100,60000)||
     !range(o["delayMs"],0,500)||!range(o["durationMs"],1,200)||
     !range(o["sound"],0,2)||!range(o["volume"],0,100)||
     !o["projection"].is<bool>()||!o["loop"].is<bool>()) return false;
  s.durationMs=timed?o["holdMs"].as<uint32_t>():1000;
  s.pwm=o["pwm"];s.rampMs=o["rampMs"];s.delayMs=o["delayMs"];
  s.ledMs=o["durationMs"];s.sound=o["sound"];s.volume=o["volume"];
  s.projection=o["projection"];s.loop=o["loop"];
  return Audio::available(s.sound);
}
void controlTick(){
  const uint32_t now=millis();const uint64_t now64=uptimeMs();Lock lock;
  const float dt=std::min<uint32_t>(100,now-state.lastTick);state.lastTick=now;
  const bool raw=homeInput();
  if(raw!=state.homeRaw){state.homeRaw=raw;state.homeChangedAt=now;}
  if(now-state.homeChangedAt>=5)state.homeStable=raw;
  if(state.mode=="fault")return;
  if(interlock()){fail("ESTOP");return;}
  if(driverFault()){fail("MOTOR_FAULT");return;}
  const bool leased=state.mode=="manual"||state.mode=="prepared"||state.mode=="armed"||state.mode=="running"||(state.mode=="homing"&&!state.bootHoming);
  if(leased&&now-lastHeartbeat.load()>LINK_TIMEOUT_MS){fail("LINK_TIMEOUT");return;}
  if(state.mode=="manual"&&now-state.manualAt>600000){fail("MANUAL_TIMEOUT");return;}
  if(state.mode=="armed"&&now64>=state.armedAt){
    state.mode="running";state.index=0;state.stageAt=state.armedAt;applyStage(state.stages[0]);
  }
  if(state.mode=="running"){
    int next=state.index;uint64_t nextAt=state.stageAt;
    while(next<state.count&&now64-nextAt>=state.stages[next].durationMs){nextAt+=state.stages[next].durationMs;next++;}
    if(next>=state.count){beginHome(true);}
    else if(next!=state.index){state.index=next;state.stageAt=nextAt;applyStage(state.stages[next]);}
    if(Audio::error.load()==3){fail("AUDIO_READ");return;}
  }
  if(state.mode=="homing"){
    if(now-state.homeBeganAt>HOME_TIMEOUT_MS){fail("HOME_TIMEOUT");return;}
    if(!state.homeCleared){
      if(!state.homeStable)state.homeCleared=true;
      else if(now-state.homeBeganAt>HOME_RELEASE_TIMEOUT_MS){fail("HOME_STUCK");return;}
    }else if(state.homeStable){
      const String finished=state.finishAfterHome?state.runId:"";
      halt("idle");driverEnable(true);state.homed=true;state.finishedRunId=finished;
    }
  }
  // Physical direction is only changed at zero PWM followed by a dead time.
  float effective=state.target;
  if(effective!=0&&((effective>0)?1:-1)!=state.direction){
    if(fabsf(state.pwm)>0.001f)effective=0;
    else{
      if(!state.reverseUntil)state.reverseUntil=now+REVERSE_HOLD_MS;
      if(int32_t(now-state.reverseUntil)<0)effective=0;
      else{state.direction=state.target>0?1:-1;state.reverseUntil=0;}
    }
  }else state.reverseUntil=0;
  const float delta=state.slewPerMs*dt;
  if(state.pwm<effective)state.pwm=std::min(effective,state.pwm+delta);
  else if(state.pwm>effective)state.pwm=std::max(effective,state.pwm-delta);
  applyMotor();
}
void controlTask(void*){
  TickType_t wake=xTaskGetTickCount();
  for(;;){controlTick();vTaskDelayUntil(&wake,pdMS_TO_TICKS(5));}
}
void response(int status,JsonDocument& doc){
  doc["version"]=1;doc["id"]=TRAIN_ID;String body;serializeJson(doc,body);
  httpServer.sendHeader("Cache-Control","no-store");httpServer.send(status,"application/json",body);
}
void errorResponse(int status,const String& reason){JsonDocument d;d["error"]=reason;response(status,d);}
bool authenticate(){
  if(httpServer.header("X-Train-Key")!=TRAIN_TOKEN){errorResponse(401,"unauthorized");return false;}
  lastHeartbeat=millis();return true;
}
void statusHandler(){
  if(!authenticate())return;
  JsonDocument d;
  {Lock lock;
    d["uptimeMs"]=uptimeMs();d["mode"]=state.mode;d["fault"]=state.fault;
    d["homed"]=state.homed;d["homeActive"]=state.homeStable;d["stage"]=state.index;
    d["pwm"]=state.pwm;d["targetPwm"]=state.target;
    d["runId"]=state.runId;d["finishedRunId"]=state.finishedRunId;
    d["lastSeq"]=state.lastSeq;d["blackout"]=state.blackout;
  }
  const auto s=Projection::stats();
  d["rpm"]=s.rpm;d["wheelPulses"]=s.wheel;d["filmPulses"]=s.film;d["missedPulses"]=s.missed;
  d["sound"]=Audio::current.load();d["audioError"]=Audio::errorMessage();
  d["sound1Ready"]=Audio::available(1);d["sound2Ready"]=Audio::available(2);
  response(200,d);
}
String processCommand(JsonObjectConst o){
  Lock lock;
  if(!o["seq"].is<uint64_t>())return "seq required";
  const uint64_t seq=o["seq"];
  if(seq<=state.lastSeq)return "stale command";
  state.lastSeq=seq;
  const String op=o["op"]|"";
  if(op=="stop"){
    const bool faulted=state.mode=="fault";
    halt(faulted?"fault":"stopped");state.runId="";state.finishedRunId="";
    driverEnable(!faulted);return "";
  }
  if(op=="clear_fault"){
    if(interlock()||driverFault()||!pwmReady||!projectionReady)return "interlock or initialization fault remains";
    if(state.mode!="fault"&&state.mode!="stopped"&&state.mode!="idle")return "stop first";
    halt("stopped");state.fault="";state.runId="";driverEnable(true);return "";
  }
  if(state.mode=="fault")return "clear fault first";
  if(op=="blackout"){
    state.blackout=true;Projection::configure(false,0,1);return "";
  }
  if(op=="home"){
    state.runId="";state.finishedRunId="";
    if(state.homed&&state.homeStable){halt("idle");state.homed=true;return "";}
    beginHome(false);return "";
  }
  if(op=="manual"){
    if(state.mode=="running"||state.mode=="armed"||state.mode=="prepared"||state.mode=="homing")return "stop first";
    Stage s;if(!readStage(o,s,false))return "invalid manual settings or WAV missing";
    state.mode="manual";state.manualAt=millis();state.runId="";state.finishedRunId="";
    state.blackout=false;driverEnable(true);applyStage(s);return "";
  }
  if(op=="prepare"){
    if(state.mode!="idle"||!state.homed||!state.homeStable)return "home first";
    const String run=o["runId"]|"";
    if(run.length()<1||run.length()>40)return "invalid runId";
    JsonObjectConst p=o["profile"];
    if(p["version"].as<int>()!=1||!p["stages"].is<JsonArrayConst>())return "invalid profile";
    JsonArrayConst a=p["stages"];if(a.size()<1||a.size()>12)return "1..12 stages required";
    Stage temp[12];int count=0;uint64_t total=0;
    for(JsonObjectConst item:a){
      if(!readStage(item,temp[count],true))return "invalid stage or WAV missing";
      total+=temp[count].durationMs;count++;
    }
    if(total>3600000)return "show exceeds 1 hour";
    for(int i=0;i<count;i++)state.stages[i]=temp[i];
    state.count=count;state.runId=run;state.finishedRunId="";state.mode="prepared";state.blackout=false;
    return "";
  }
  if(op=="arm"){
    if(state.mode!="prepared"||state.runId!=String(o["runId"]|""))return "prepare first";
    if(!o["startAtMs"].is<uint64_t>())return "startAtMs required";
    const uint64_t at=o["startAtMs"],now=uptimeMs();
    if(at<now+500||at>now+15000)return "invalid start time";
    state.armedAt=at;state.mode="armed";return "";
  }
  return "unknown operation";
}
void commandHandler(){
  if(!authenticate())return;
  const String body=httpServer.arg("plain");
  if(body.length()>12000){errorResponse(413,"payload too large");return;}
  JsonDocument d;
  if(deserializeJson(d,body)||!d.is<JsonObject>()){errorResponse(400,"invalid JSON");return;}
  const String error=processCommand(d.as<JsonObjectConst>());
  if(error.length()){errorResponse(409,error);return;}
  JsonDocument result;result["ok"]=true;response(200,result);
}
void firmwareSetup(){
  pinMode(MOTOR_PWM_PIN,OUTPUT);digitalWrite(MOTOR_PWM_PIN,LOW);
  pinMode(MOTOR_DIR_PIN,OUTPUT);digitalWrite(MOTOR_DIR_PIN,LOW);
  if(MOTOR_SLEEP_PIN>=0){pinMode(MOTOR_SLEEP_PIN,OUTPUT);digitalWrite(MOTOR_SLEEP_PIN,LOW);}
  pinMode(LED_PIN,OUTPUT);digitalWrite(LED_PIN,LOW);
  pinMode(HOME_PIN,INPUT_PULLUP);
  if(MOTOR_FAULT_PIN>=0)pinMode(MOTOR_FAULT_PIN,INPUT_PULLUP);
  if(ESTOP_PIN>=0)pinMode(ESTOP_PIN,INPUT_PULLUP);
  Serial.begin(115200);
  controlMutex=xSemaphoreCreateMutex();
  if(!controlMutex){Serial.println("FATAL: control mutex");return;}
  pwmReady=ledcAttach(MOTOR_PWM_PIN,20000,10);
  projectionReady=Projection::begin();
  Audio::begin();
  state.lastTick=millis();state.homeRaw=state.homeStable=homeInput();
  state.homeChangedAt=millis();lastHeartbeat=millis();
  if(!Audio::requests){state.mode="fault";state.fault="AUDIO_QUEUE";return;}
  if(!pwmReady||!projectionReady||strlen(TRAIN_TOKEN)<24){fail("INITIALIZATION");}
  if(xTaskCreatePinnedToCore(controlTask,"motion",8192,nullptr,4,nullptr,1)!=pdPASS){fail("CONTROL_TASK");return;}
  if(state.mode!="fault"){
    Lock lock;driverEnable(true);if(AUTO_HOME_ON_BOOT)beginHome(false,true);
  }
  WiFi.mode(WIFI_STA);WiFi.setSleep(false);
  WiFi.setHostname(TRAIN_ID==1?"memory-train-1":"memory-train-2");
  WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
  const char* headers[]={"X-Train-Key"};httpServer.collectHeaders(headers,1);
  httpServer.on("/api/status",HTTP_GET,statusHandler);
  httpServer.on("/api/command",HTTP_POST,commandHandler);
  httpServer.onNotFound([](){errorResponse(404,"not found");});
  httpServer.begin();
}
void firmwareLoop(){
  httpServer.handleClient();
  static uint32_t retry=0;static bool printed=false;
  if(WiFi.status()==WL_CONNECTED&&!printed){Serial.print("Train IP: ");Serial.println(WiFi.localIP());printed=true;}
  if(WiFi.status()!=WL_CONNECTED&&millis()-retry>10000){retry=millis();printed=false;WiFi.reconnect();}
  delay(1);
}
