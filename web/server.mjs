import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {timingSafeEqual} from 'node:crypto';
import {Coordinator} from './lib/coordinator.mjs';
import {defaultShow,validateShow,trainSettings,privateAddress} from './lib/protocol.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(await readFile(join(root,'../config/local.json'),'utf8'));
if(typeof config.controlKey!=='string'||config.controlKey.length<24||config.controlKey.startsWith('REPLACE')) throw new Error('먼저 node tools/setup.mjs 실행');
if(!Array.isArray(config.trains)||config.trains.length!==2||config.trains.map(t=>t.id).sort().join(',')!=='1,2') throw new Error('열차 1, 2 설정 필요');
for(const t of config.trains) {
  if(!privateAddress(t.host)||!Number.isInteger(t.port)||t.port<1||t.port>65535||typeof t.token!=='string'||t.token.length<24) throw new Error('열차 주소/키 오류');
}
await mkdir(join(root,'data'),{recursive:true});
const showFile=join(root,'data/show.json');
let show;
try {show=validateShow(JSON.parse(await readFile(showFile,'utf8')));}
catch(e) {if(e.code!=='ENOENT') throw e;show=defaultShow();}
let sequence=Date.now()*1000;
function keyMatches(value) {
  if(typeof value!=='string') return false;
  const a=Buffer.from(value),b=Buffer.from(config.controlKey);
  return a.length===b.length&&timingSafeEqual(a,b);
}
async function device(id,path,body) {
  const t=config.trains.find(t=>t.id===id);
  if(!t) throw new Error('열차 번호 오류');
  const response=await fetch('http://'+t.host+':'+t.port+path,{
    method:body?'POST':'GET',headers:{'X-Train-Key':t.token,'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(1000)
  });
  const result=await response.json();
  if(!response.ok) throw new Error('열차 '+id+': '+(result.error||response.status));
  if(result.id!==id||result.version!==1) throw new Error('열차 ID / 프로토콜 불일치');
  if(Number.isSafeInteger(result.lastSeq))sequence=Math.max(sequence,result.lastSeq);
  return result;
}
const coordinator=new Coordinator({
  status:id=>device(id,'/api/status'),
  command:(id,payload)=>device(id,'/api/command',{...payload,seq:++sequence})
});
function reply(res,status,value) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(value));
}
async function readJson(req) {
  let bytes=0;const chunks=[];
  for await(const chunk of req) {bytes+=chunk.length;if(bytes>24000) throw new Error('요청 크기 초과');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
}
const assets=new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']]
]);
let saving=false;
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&assets.has(url.pathname)) {
      const [file,type]=assets.get(url.pathname);
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"});
      res.end(await readFile(join(root,'public',file)));return;
    }
    if(!url.pathname.startsWith('/api/')) return reply(res,404,{error:'없는 주소'});
    if(!keyMatches(req.headers['x-control-key'])) return reply(res,401,{error:'제어 키를 확인하세요.'});
    // No cross-origin policy is enabled: control requests must originate from this page.
    const origin=req.headers.origin;
    if(origin&&new URL(origin).host!==req.headers.host) return reply(res,403,{error:'다른 출처의 요청'});
    if(req.method==='GET'&&url.pathname==='/api/status') return reply(res,200,coordinator.snapshot());
    if(req.method==='GET'&&url.pathname==='/api/show') return reply(res,200,show);
    if(req.method!=='POST') return reply(res,405,{error:'허용되지 않은 메서드'});
    const body=await readJson(req);
    if(url.pathname==='/api/show') {
      if(saving) return reply(res,409,{error:'저장 중'});
      const next=validateShow(body);saving=true;
      try {
        await writeFile(showFile+'.tmp',JSON.stringify(next,null,2)+'\n',{mode:0o600});
        await rename(showFile+'.tmp',showFile);show=next;
      } finally {saving=false;}
      return reply(res,200,{ok:true,notice:'저장 완료. 다음 전체 시작부터 적용됩니다.'});
    }
    if(url.pathname==='/api/start') return reply(res,200,await coordinator.start(show));
    if(url.pathname==='/api/stop') return reply(res,200,{results:await coordinator.stop()});
    if(url.pathname==='/api/home') return reply(res,200,await coordinator.both('home'));
    if(url.pathname==='/api/blackout') return reply(res,200,await coordinator.both('blackout'));
    if(url.pathname==='/api/clear-fault') return reply(res,200,await coordinator.both('clear_fault'));
    const match=url.pathname.match(/^\/api\/trains\/([12])\/manual$/);
    if(match) return reply(res,200,await coordinator.manual(Number(match[1]),trainSettings(body)));
    return reply(res,404,{error:'없는 주소'});
  } catch(e) {if(!res.headersSent) reply(res,400,{error:e.message});else res.destroy();}
});
server.requestTimeout=5000;server.headersTimeout=5000;
const poll=setInterval(()=>coordinator.poll(),500);
await coordinator.poll();
server.listen(config.port,config.host,()=>console.log('제어 웹: http://'+config.host+':'+config.port+' (제어 키는 config/local.json)'));
let quitting=false;
async function shutdown(){
  if(quitting)return;quitting=true;clearInterval(poll);
  await coordinator.stop();server.close();setTimeout(()=>process.exit(0),1200).unref();
}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
