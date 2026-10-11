import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {profileFor, validateShow} from './protocol.mjs';

// transport.command(id, payload), transport.status(id); status renews device lease.
export class Coordinator {
  constructor(transport, clock=()=>performance.now()) {
    this.transport=transport; this.clock=clock; this.generation=0; this.busy=false;
    this.status={1:null,2:null}; this.show=null; this.runId=null;
    this.repeat=false; this.nextAt=null; this.error=null; this.polling=false;
  }
  async stop() {
    ++this.generation; this.repeat=false; this.nextAt=null; this.runId=null;
    const results=await Promise.allSettled([1,2].map(id=>this.transport.command(id,{op:'stop'})));
    this.error=results.some(r=>r.status==='rejected')?'정지 응답 누락: 해당 열차의 통신 자동정지/현장 정지 확인':null;
    return results.map((r,i)=>({id:i+1,ok:r.status==='fulfilled'}));
  }
  async both(op) {
    if(op==='stop') return this.stop();
    if(this.busy) throw new Error('다른 명령 처리 중');
    this.busy=true;
    try {
      if(op==='home') {this.repeat=false;this.runId=null;this.nextAt=null;}
      const results=await Promise.allSettled([1,2].map(id=>this.transport.command(id,{op})));
      if(results.some(r=>r.status==='rejected')) throw new Error('일부 열차가 명령을 거부했습니다.');
      return {ok:true};
    } catch(e) {if(op==='home')await this.stop();throw e;}
    finally {this.busy=false;}
  }
  async start(input) {
    if(this.busy) throw new Error('다른 명령 처리 중');
    const show=validateShow(input);
    this.busy=true; const generation=++this.generation;
    this.nextAt=null; this.repeat=false;
    const guard=()=>{if(generation!==this.generation) throw new Error('시작 취소됨');};
    try {
      const states=await Promise.all([1,2].map(id=>this.transport.status(id)));
      guard();
      if(states.some(s=>s.mode!=='idle'||!s.homed||!s.homeActive)) throw new Error('두 열차를 원점에 복귀시킨 뒤 시작하세요.');
      const runId=randomUUID();
      await Promise.all([1,2].map(id=>this.transport.command(id,{op:'prepare',runId,profile:profileFor(show,id)})));
      guard();
      // Pick the lowest RTT of three samples. This is approximate, not audio sample sync.
      const samples={};
      for(let i=0;i<3;i++) {
        await Promise.all([1,2].map(async id=>{
          const before=this.clock(); const s=await this.transport.status(id); const after=this.clock();
          const sample={rtt:after-before,offset:s.uptimeMs-(before+after)/2};
          if(!samples[id]||sample.rtt<samples[id].rtt) samples[id]=sample;
        }));
        guard();
      }
      if([1,2].some(id=>samples[id].rtt>250)) throw new Error('무선 응답이 느립니다. 공유기 위치와 신호를 확인하세요.');
      const startAt=this.clock()+4000;
      await Promise.all([1,2].map(id=>this.transport.command(id,{op:'arm',runId,startAtMs:Math.round(startAt+samples[id].offset)})));
      guard();
      const armed=await Promise.all([1,2].map(id=>this.transport.status(id)));
      guard();
      if(armed.some(s=>s.mode!=='armed'||s.runId!==runId) || this.clock()>startAt-500) throw new Error('시작 준비 확인 실패');
      this.show=show;this.runId=runId;this.repeat=show.repeat;this.error=null;
      return {ok:true,runId,startInMs:Math.round(startAt-this.clock()),roundTripMs:[samples[1].rtt,samples[2].rtt]};
    } catch(e) {
      await this.stop(); this.error=e.message; throw e;
    } finally {this.busy=false;}
  }
  async manual(id, settings) {
    if(this.busy || this.runId || this.repeat) throw new Error('전체 정지 후 수동 조작하세요.');
    this.busy=true;
    try {return await this.transport.command(id,{op:'manual',...settings});}
    finally {this.busy=false;}
  }
  async poll() {
    if(this.polling) return;
    this.polling=true;
    try {
      const results=await Promise.allSettled([1,2].map(id=>this.transport.status(id)));
      results.forEach((r,i)=>this.status[i+1]=r.status==='fulfilled'?{...r.value,online:true}:{online:false,error:String(r.reason.message)});
      if(this.runId && [1,2].some(id=>!this.status[id].online||['fault','stopped'].includes(this.status[id].mode))) {
        await this.stop(); this.error='열차 오류 또는 연결 끊김으로 전시를 정지했습니다.'; return;
      }
      if(this.runId && [1,2].every(id=>this.status[id].finishedRunId===this.runId&&this.status[id].homed)) {
        this.runId=null;
        if(this.repeat) this.nextAt=this.clock()+this.show.waitMs;
      }
      if(this.repeat&&this.nextAt!==null&&this.clock()>=this.nextAt&&!this.busy) {
        await this.start(this.show);
      }
    } catch(e) {this.error=e.message;}
    finally {this.polling=false;}
  }
  snapshot() {
    return {trains:this.status,runId:this.runId,repeat:this.repeat,busy:this.busy,error:this.error,
      nextInMs:this.nextAt===null?null:Math.max(0,Math.round(this.nextAt-this.clock()))};
  }
}
