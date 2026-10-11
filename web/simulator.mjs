import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {SimDevice} from './lib/sim-device.mjs';
const config=JSON.parse(await readFile(new URL('../config/local.json',import.meta.url),'utf8'));
if(config.trains.some(t=>t.host!=='127.0.0.1'||![8081,8082].includes(t.port)))throw new Error('별도 시험 폴더에서 node tools/setup.mjs --sim으로 설정하세요.');
for(const t of config.trains){
  const device=new SimDevice(t.id);
  const server=http.createServer(async(req,res)=>{
    const send=(status,v)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
    if(req.headers['x-train-key']!==t.token)return send(401,{error:'unauthorized'});
    try{
      if(req.method==='GET'&&req.url==='/api/status')return send(200,device.status());
      if(req.method==='POST'&&req.url==='/api/command'){
        let text='';for await(const chunk of req){text+=chunk;if(text.length>12000)throw new Error('too large');}
        return send(200,device.command(JSON.parse(text)));
      }
      send(404,{error:'not found'});
    }catch(e){send(409,{error:e.message,version:1,id:t.id});}
  });
  setInterval(()=>device.tick(),10);
  server.listen(t.port,'127.0.0.1',()=>console.log('가상 열차 '+t.id+': '+t.port+' / 실제 장치를 제어하지 않습니다.'));
}
