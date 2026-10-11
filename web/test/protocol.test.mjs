import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultShow,validateShow,profileFor,privateAddress} from '../lib/protocol.mjs';

test('scene hold and LED duration are separate on the wire',()=>{
  const p=profileFor(defaultShow(),1);
  assert.equal(p.stages[1].holdMs,10000);
  assert.equal(p.stages[1].durationMs,35);
  assert.equal(p.stages[1].delayMs,60);
});
test('reject invalid speeds and malformed profile before dispatch',()=>{
  for(const bad of [61,-61,NaN,12.5,'30',null]){
    const s=defaultShow();s.stages[0].trains[1].pwm=bad;
    assert.throws(()=>validateShow(s));
  }
  const s=defaultShow();s.stages[0].trains[2].projection='false';
  assert.throws(()=>validateShow(s));
});
test('reject excessive stage duration and LED on-time',()=>{
  const s=defaultShow();s.stages[0].durationMs=600001;
  assert.throws(()=>validateShow(s));
  const t=defaultShow();t.stages[0].trains[1].durationMs=0;
  assert.throws(()=>validateShow(t));
});
test('only configured local IPv4 hosts are allowed',()=>{
  assert.equal(privateAddress('192.168.10.101'),true);
  assert.equal(privateAddress('172.20.0.2'),true);
  for(const host of ['8.8.8.8','169.254.169.254','127.0.0.1.evil','localhost:80','192.168.0.999','0127.0.0.1','10..0.1'])
    assert.equal(privateAddress(host),false);
});
