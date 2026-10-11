let controlKey='', show=null, timer=null, polling=false;
const $=id=>document.getElementById(id);
const modeNames={idle:'원점 대기',stopped:'정지',manual:'수동',homing:'원점 탐색',prepared:'준비',armed:'시작 대기',running:'전시 진행',fault:'오류'};
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
async function api(path,body){
  const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'X-Control-Key':controlKey,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  const value=await r.json();if(!r.ok)throw new Error(value.error||r.status);return value;
}
function el(tag,text,attrs={}){const e=document.createElement(tag);if(text!==null)e.textContent=text;Object.assign(e,attrs);return e;}
function number(parent,label,value,min,max,set){
  const l=el('label',label),input=el('input',null,{type:'number',value,min,max,step:1});input.addEventListener('change',()=>set(Number(input.value)));l.append(input);parent.append(l);
}
function check(parent,label,value,set){
  const l=el('label',null,{className:'check'}),input=el('input',null,{type:'checkbox',checked:value});input.addEventListener('change',()=>set(input.checked));l.append(input,document.createTextNode(label));parent.append(l);
}
function settings(parent,s){
  const fields=el('div',null,{className:'fields'});parent.append(fields);
  number(fields,'PWM % (역방향 −)',s.pwm,-60,60,v=>s.pwm=v);
  number(fields,'가감속 ms',s.rampMs,100,60000,v=>s.rampMs=v);
  number(fields,'LED 지연 ms',s.delayMs,0,500,v=>s.delayMs=v);
  number(fields,'LED 점등 ms',s.durationMs,1,200,v=>s.durationMs=v);
  number(fields,'음원 0/1/2',s.sound,0,2,v=>s.sound=v);
  number(fields,'음량 %',s.volume,0,100,v=>s.volume=v);
  check(fields,'투사',s.projection,v=>s.projection=v);check(fields,'음원 반복',s.loop,v=>s.loop=v);
}
function renderTrains(){
  $('trains').replaceChildren();
  for(const id of [1,2]){
    const c=el('article',null,{className:'train'});c.append(el('h2',id===1?'01 · 바깥 / 풍경':'02 · 안쪽 / 시선'));
    c.append(el('p','연결 대기',{id:'train-state-'+id}));
    const dl=el('dl',null);
    for(const [key,label] of [['rpm','바퀴 RPM'],['stage','진행 장면'],['home','시작점 센서'],['film','필름 펄스 / 누락'],['audio','음원 상태']]){
      dl.append(el('dt',label),el('dd','—',{id:key+'-'+id}));
    }
    c.append(dl);
    const d=el('details',null),summary=el('summary','수동 조정 · 전체 정지 후 사용');d.append(summary);
    const s={pwm:0,rampMs:2000,projection:false,delayMs:20,durationMs:10,sound:0,volume:30,loop:false};settings(d,s);
    const b=el('button','이 열차에 적용');b.addEventListener('click',()=>action(()=>api('/trains/'+id+'/manual',s),'수동 설정 적용'));d.append(b);c.append(d);$('trains').append(c);
  }
}
function renderShow(){
  $('repeat').checked=show.repeat;$('wait').value=show.waitMs/1000;$('stages').replaceChildren();
  show.stages.forEach((s,i)=>{
    const section=el('div',null,{className:'stage'}),title=el('div',null,{className:'stage-title'});
    title.append(el('strong',String(i+1).padStart(2,'0')));
    const name=el('input',null,{type:'text',value:s.name,maxLength:40});name.setAttribute('aria-label','장면 이름');name.onchange=()=>s.name=name.value;title.append(name);
    number(title,'길이 ms',s.durationMs,100,600000,v=>s.durationMs=v);
    for(const [label,delta] of [['위',-1],['아래',1]]){
      const b=el('button',label);b.disabled=i+delta<0||i+delta>=show.stages.length;
      b.onclick=()=>{[show.stages[i],show.stages[i+delta]]=[show.stages[i+delta],show.stages[i]];renderShow();};title.append(b);
    }
    const del=el('button','삭제');del.disabled=show.stages.length===1;del.onclick=()=>{show.stages.splice(i,1);renderShow();};title.append(del);section.append(title);
    const trains=el('div',null,{className:'stage-trains'});
    for(const id of [1,2]){const p=el('div',null,{className:'stage-train'});p.append(el('p',id===1?'바깥 열차':'안쪽 열차'));settings(p,s.trains[id]);trains.append(p);}
    section.append(trains);$('stages').append(section);
  });
}
async function action(fn,message){
  try{const r=await fn();if(r?.results?.some(x=>!x.ok)){notice('일부 열차의 정지 응답이 없습니다. 현장 상태를 확인하세요.',true);return;}notice(message);await poll();}
  catch(e){notice(e.message,true);}
}
async function poll(){
  if(polling)return;polling=true;
  try{
    const s=await api('/status');$('connection').textContent='제어 서버 연결됨';
    if(s.error)notice(s.error,true);
    for(const id of [1,2]){
      const t=s.trains[id];$('train-state-'+id).textContent=t?.online?(t.simulated?'[가상 열차] ':'')+(modeNames[t.mode]||t.mode)+(t.fault?' · '+t.fault:''):'무선 연결 끊김';
      $('train-state-'+id).classList.toggle('error',!t?.online||t.mode==='fault');
      if(!t?.online){for(const key of ['rpm','stage','home','film','audio'])$(key+'-'+id).textContent='—';continue;}
      $('rpm-'+id).textContent=Number(t.rpm).toFixed(1);
      $('stage-'+id).textContent=t.mode==='running'?String(t.stage+1):'—';
      $('home-'+id).textContent=t.homeActive?'감지':'비감지';
      $('film-'+id).textContent=t.filmPulses+' / '+t.missedPulses;
      $('audio-'+id).textContent=t.audioError||('음원 '+t.sound);
    }
  }catch(e){$('connection').textContent='제어 서버 연결 끊김';}
  finally{polling=false;}
}
$('login-form').onsubmit=async e=>{
  e.preventDefault();controlKey=$('key').value;
  try{show=await api('/show');$('login').hidden=true;$('console').hidden=false;renderTrains();renderShow();await poll();clearInterval(timer);timer=setInterval(poll,1000);}
  catch(e){$('connection').textContent=e.message;}
};
$('repeat').onchange=()=>show.repeat=$('repeat').checked;
$('wait').onchange=()=>show.waitMs=Math.round(Number($('wait').value)*1000);
$('save').onclick=()=>action(()=>api('/show',show),'저장 완료 · 다음 전체 시작부터 적용');
$('reload').onclick=()=>action(async()=>{show=await api('/show');renderShow();},'저장값 불러옴');
$('add').onclick=()=>{if(show.stages.length>=12)return notice('최대 12개 장면',true);const s=structuredClone(show.stages.at(-1));s.name='새 장면';show.stages.push(s);renderShow();};
for(const [id,path,message] of [['home','/home','원점 복귀 중'],['start','/start','시작 준비 완료'],['stop','/stop','전체 정지 명령 전송'],['blackout','/blackout','영상 암전 적용'],['clear','/clear-fault','오류 해제 요청 완료']]){
  $(id).onclick=()=>action(()=>api(path,{}),message);
}
