import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,cp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {SimDevice} from '../lib/sim-device.mjs';
import {defaultShow} from '../lib/protocol.mjs';

async function listen(server){
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return server.address().port;
}
async function waitFor(fn,timeout=8000){
  const end=Date.now()+timeout;let last;
  while(Date.now()<end){try{const result=await fn();if(result)return result;}catch(e){last=e;}await delay(50);}
  throw last||new Error('timeout waiting for test condition');
}
test('HTTP authentication, persistence, two-train arming and cancellation',{timeout:20000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'memory-trains-'));
  const devices={};const servers=[];let child;
  t.after(async()=>{
    if(child&&child.exitCode===null){
      const exited=new Promise(resolve=>child.once('exit',resolve));
      child.kill('SIGTERM');
      await Promise.race([exited,delay(3000)]);
      if(child.exitCode===null){child.kill('SIGKILL');await exited;}
    }
    for(const server of servers){
      server.closeAllConnections();
      await new Promise(resolve=>server.close(resolve));
    }
    await rm(dir,{recursive:true,force:true});
  });
  const config={host:'127.0.0.1',port:0,controlKey:'test-browser-key-000000000000',trains:[]};
  for(const id of [1,2]){
    const d=new SimDevice(id);devices[id]=d;
    const token='test-train-key-000000000000'+id;
    const server=http.createServer(async(req,res)=>{
      const send=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
      if(req.headers['x-train-key']!==token)return send(401,{error:'bad token'});
      try{
        if(req.url==='/api/status'&&req.method==='GET')return send(200,d.status());
        let body='';for await(const chunk of req)body+=chunk;
        send(200,d.command(JSON.parse(body)));
      }catch(e){send(409,{version:1,id,error:e.message});}
    });
    servers.push(server);
    config.trains.push({id,host:'127.0.0.1',port:await listen(server),token});
  }
  const reservation=http.createServer();
  config.port=await listen(reservation);
  await new Promise(resolve=>reservation.close(resolve));
  await mkdir(join(dir,'config'));
  await writeFile(join(dir,'config/local.json'),JSON.stringify(config));
  await cp(new URL('../',import.meta.url),join(dir,'web'),{recursive:true});
  child=spawn(process.execPath,[join(dir,'web/server.mjs')],{stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const base='http://127.0.0.1:'+config.port;
  await waitFor(async()=>{
    if(child.exitCode!==null)throw new Error('Server exited: '+output);
    return (await fetch(base,{signal:AbortSignal.timeout(500)})).status===200;
  });
  const request=(path,body)=>fetch(base+'/api'+path,{
    method:body===undefined?'GET':'POST',
    headers:{'X-Control-Key':config.controlKey,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)
  });
  assert.equal((await fetch(base+'/api/status')).status,401);
  assert.equal((await fetch(base+'/app.js')).status,200);
  const invalid=defaultShow();invalid.stages[0].trains[1].pwm=99;
  assert.equal((await request('/show',invalid)).status,400);
  const show=defaultShow();show.stages=show.stages.slice(0,1);show.stages[0].name='HTTP test';
  assert.equal((await request('/show',show)).status,200);
  assert.equal((await (await request('/show')).json()).stages[0].name,'HTTP test');
  assert.equal(JSON.parse(await readFile(join(dir,'web/data/show.json'),'utf8')).stages[0].name,'HTTP test');
  assert.equal((await request('/home',{})).status,200);
  await waitFor(()=>devices[1].homed&&devices[2].homed);
  const started=await request('/start',{});assert.equal(started.status,200,await started.text());
  assert.equal(devices[1].mode,'armed');assert.equal(devices[2].mode,'armed');
  assert.equal((await request('/blackout',{})).status,200);
  assert.equal(devices[1].blackout,true);assert.equal(devices[2].blackout,true);
  assert.equal((await request('/stop',{})).status,200);
  await delay(4500);
  assert.equal(devices[1].mode,'stopped');assert.equal(devices[2].mode,'stopped');
  assert.equal(devices[1].pwm,0);assert.equal(devices[2].pwm,0);
});
