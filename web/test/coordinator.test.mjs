import test from 'node:test';
import assert from 'node:assert/strict';
import {Coordinator} from '../lib/coordinator.mjs';
import {SimDevice} from '../lib/sim-device.mjs';
import {defaultShow} from '../lib/protocol.mjs';

function fixture(){
  let now=1000,seq=0;
  const d={1:new SimDevice(1,()=>now),2:new SimDevice(2,()=>now)};
  const transport={status:async id=>d[id].status(),command:async(id,p)=>d[id].command({...p,seq:++seq})};
  const c=new Coordinator(transport,()=>now);
  return {c,d,transport,advance:async(ms)=>{
    while(ms>0){const step=Math.min(ms,50);now+=step;await c.poll();ms-=step;}
  }};
}
async function home(f){await f.c.both('home');await f.advance(600);}
test('cannot start before both trains have homed',async()=>{
  const f=fixture();await assert.rejects(()=>f.c.start(defaultShow()),/원점/);
  assert.equal(f.c.runId,null);
});
test('two trains arm together, finish, home, and wait for a coordinated repeat',async()=>{
  const f=fixture();await home(f);
  const s=defaultShow();s.stages=s.stages.slice(0,1);s.stages[0].durationMs=100;s.repeat=true;s.waitMs=1000;
  const r=await f.c.start(s);
  assert.equal(f.d[1].mode,'armed');assert.equal(f.d[2].mode,'armed');
  assert.equal(f.d[1].at,f.d[2].at);
  await f.advance(4700);
  assert.equal(f.d[1].finishedRunId,r.runId);assert.equal(f.d[2].finishedRunId,r.runId);
  assert.equal(f.c.runId,null);
  await assert.rejects(()=>f.c.manual(1,s.stages[0].trains[1]),/정지/);
  await f.advance(1000);
  assert.equal(f.d[1].mode,'armed');assert.notEqual(f.c.runId,r.runId);
});
test('failure to arm either train sends stop to both',async()=>{
  const f=fixture();await home(f);const original=f.transport.command;
  f.transport.command=async(id,p)=>{if(id===2&&p.op==='arm')throw new Error('radio failed');return original(id,p);};
  await assert.rejects(()=>f.c.start(defaultShow()),/radio failed/);
  assert.equal(f.d[1].mode,'stopped');assert.equal(f.d[2].mode,'stopped');
  assert.equal(f.c.repeat,false);
});
test('failed home command cancels movement on the other train',async()=>{
  const f=fixture();const original=f.transport.command;
  f.transport.command=async(id,p)=>{if(id===2&&p.op==='home')throw new Error('offline');return original(id,p);};
  await assert.rejects(()=>f.c.both('home'));
  assert.equal(f.d[1].mode,'stopped');
});
test('device watchdog stops an active train without relying on the server',()=>{
  let now=0;const d=new SimDevice(1,()=>now);
  d.command({op:'manual',seq:1,...defaultShow().stages[1].trains[1]});
  now=3001;d.tick();assert.equal(d.mode,'fault');assert.equal(d.pwm,0);assert.equal(d.fault,'LINK_TIMEOUT');
});
test('a delayed old movement command cannot undo a newer stop',()=>{
  const d=new SimDevice(1,()=>0);
  d.command({op:'stop',seq:100});
  assert.throws(()=>d.command({op:'manual',seq:99,...defaultShow().stages[1].trains[1]}),/stale/);
  assert.equal(d.mode,'stopped');
});
