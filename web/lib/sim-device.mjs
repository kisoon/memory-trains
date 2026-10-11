import {trainSettings,integer} from './protocol.mjs';
export class SimDevice {
  constructor(id,clock=()=>performance.now()){
    this.id=id;this.clock=clock;this.started=clock();this.lastBeat=clock();this.seq=0;
    this.mode='stopped';this.homed=false;this.homeActive=false;this.stage=-1;
    this.runId='';this.finishedRunId='';this.fault='';this.targetPwm=0;this.pwm=0;
    this.blackout=false;this.profile=[];this.sound=0;this.filmPulses=0;this.lastTick=clock();
  }
  now(){return this.clock()-this.started;}
  tick(){
    const now=this.clock(),dt=now-this.lastTick;this.lastTick=now;
    if(['prepared','armed','running','homing','manual'].includes(this.mode)&&now-this.lastBeat>3000){
      this.mode='fault';this.fault='LINK_TIMEOUT';this.pwm=this.targetPwm=0;this.sound=0;this.homed=false;
    }
    if(this.mode==='armed'&&this.now()>=this.at){this.mode='running';this.stage=0;this.stageAt=this.at;}
    if(this.mode==='running'){
      while(this.stage<this.profile.length&&this.now()-this.stageAt>=this.profile[this.stage].holdMs){
        this.stageAt+=this.profile[this.stage].holdMs;this.stage++;
      }
      if(this.stage>=this.profile.length){this.mode='homing';this.homeAt=now+500;this.finish=true;this.sound=0;}
      else{
        const s=this.profile[this.stage];this.targetPwm=this.pwm=s.pwm;this.sound=s.sound;
        if(s.pwm!==0){this.homed=false;this.homeActive=false;}
        if(s.projection&&!this.blackout)this.filmPulses+=Math.abs(s.pwm)*dt/1000;
      }
    }
    if(this.mode==='homing'&&now>=this.homeAt){
      this.mode='idle';this.homed=this.homeActive=true;this.pwm=this.targetPwm=0;this.stage=-1;
      if(this.finish)this.finishedRunId=this.runId;this.finish=false;
    }
  }
  status(){
    this.tick();this.lastBeat=this.clock();
    return {version:1,id:this.id,uptimeMs:this.now(),mode:this.mode,fault:this.fault,homed:this.homed,
      homeActive:this.homeActive,stage:this.stage,pwm:this.pwm,targetPwm:this.targetPwm,
      runId:this.runId,finishedRunId:this.finishedRunId,rpm:Math.abs(this.pwm)*2,
      filmPulses:Math.floor(this.filmPulses),missedPulses:0,sound:this.sound,audioError:'',
      sound1Ready:true,sound2Ready:true,blackout:this.blackout,lastSeq:this.seq,simulated:true};
  }
  command(c){
    this.tick();this.lastBeat=this.clock();
    if(!Number.isSafeInteger(c.seq)||c.seq<=this.seq)throw new Error('stale command');this.seq=c.seq;
    if(c.op==='stop'){this.mode=this.mode==='fault'?'fault':'stopped';this.homed=false;this.pwm=this.targetPwm=0;this.sound=0;this.runId='';this.finishedRunId='';}
    else if(c.op==='clear_fault'){
      if(!['fault','stopped','idle'].includes(this.mode))throw new Error('stop first');
      this.fault='';this.mode='stopped';this.homed=false;
    }
    else if(this.mode==='fault')throw new Error('clear fault first');
    else if(c.op==='blackout')this.blackout=true;
    else if(c.op==='home'){this.mode='homing';this.homeAt=this.clock()+500;this.finish=false;this.runId='';this.finishedRunId='';}
    else if(c.op==='manual'){
      if(!['idle','stopped','manual'].includes(this.mode))throw new Error('stop first');
      const s=trainSettings(c);this.mode='manual';this.pwm=this.targetPwm=s.pwm;this.sound=s.sound;this.blackout=false;if(s.pwm)this.homed=false;
    }
    else if(c.op==='prepare'){
      if(this.mode!=='idle'||!this.homed||!this.homeActive)throw new Error('home first');
      if(!Array.isArray(c.profile?.stages)||c.profile.stages.length<1||c.profile.stages.length>12)throw new Error('invalid stages');
      const stages=c.profile.stages.map(s=>({...trainSettings(s),holdMs:integer(s.holdMs,100,600000,'holdMs')}));
      this.profile=stages;this.runId=c.runId;this.finishedRunId='';this.mode='prepared';this.blackout=false;
    }
    else if(c.op==='arm'){
      if(this.mode!=='prepared'||this.runId!==c.runId||c.startAtMs<this.now()+500||c.startAtMs>this.now()+15000)throw new Error('invalid arm');
      this.at=c.startAtMs;this.mode='armed';
    }
    else throw new Error('unknown operation');
    return {ok:true,version:1,id:this.id};
  }
}
