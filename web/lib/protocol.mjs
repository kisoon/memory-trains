export const VERSION = 1;
export const MAX_STAGES = 12;
export function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(name + ': ' + min + ' ~ ' + max);
  return value;
}
export function trainSettings(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('열차 설정 형식 오류');
  if (typeof s.projection !== 'boolean' || typeof s.loop !== 'boolean') throw new Error('projection / loop는 boolean');
  return {
    pwm: integer(s.pwm, -60, 60, 'PWM (%)'),
    rampMs: integer(s.rampMs, 100, 60000, '가감속 시간 (ms)'),
    projection: s.projection,
    delayMs: integer(s.delayMs, 0, 500, 'LED 지연 (ms)'),
    durationMs: integer(s.durationMs, 1, 200, 'LED 점등 (ms)'),
    sound: integer(s.sound, 0, 2, '음원'),
    volume: integer(s.volume, 0, 100, '음량'),
    loop: s.loop
  };
}
export function validateShow(input) {
  if (!input || input.version !== VERSION) throw new Error('version은 1');
  if (typeof input.repeat !== 'boolean') throw new Error('repeat는 boolean');
  const waitMs = integer(input.waitMs, 1000, 600000, '반복 대기 (ms)');
  if (!Array.isArray(input.stages) || input.stages.length < 1 || input.stages.length > MAX_STAGES) throw new Error('단계 수: 1 ~ 12');
  const stages = input.stages.map((s, i) => ({
    name: String(s.name || '장면 ' + (i+1)).slice(0, 40),
    durationMs: integer(s.durationMs, 100, 600000, '장면 길이 (ms)'),
    trains: {'1': trainSettings(s.trains?.['1']), '2': trainSettings(s.trains?.['2'])}
  }));
  if (stages.reduce((n,s)=>n+s.durationMs,0) > 3600000) throw new Error('한 회차는 최대 1시간');
  return {version: VERSION, repeat: input.repeat, waitMs, stages};
}
export function profileFor(show, id) {
  return {version: VERSION, stages: show.stages.map(s => ({holdMs:s.durationMs, ...s.trains[String(id)]}))};
}
export function defaultShow() {
  const t=(pwm,projection,delayMs,durationMs,sound=0)=>({pwm,projection,delayMs,durationMs,sound,volume:40,loop:sound>0,rampMs:3000});
  return validateShow({version:1,repeat:false,waitMs:10000,stages:[
    {name:'암전 · 대기',durationMs:3000,trains:{1:t(0,false,30,30),2:t(0,false,30,30)}},
    {name:'느린 출발',durationMs:10000,trains:{1:t(20,true,60,35),2:t(16,true,60,35)}},
    {name:'영상 형성',durationMs:15000,trains:{1:t(35,true,20,12),2:t(27,true,20,12)}},
    {name:'허밍 · 풍경',durationMs:20000,trains:{1:t(35,true,20,12,1),2:t(27,true,20,12,1)}},
    {name:'소리만 남음',durationMs:10000,trains:{1:t(18,false,20,12,2),2:t(14,false,20,12,2)}}
  ]});
}
export function privateAddress(host) {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(String(host))) return false;
  const p=String(host).split('.').map(Number);
  if(p.length!==4 || p.some(n=>!Number.isInteger(n)||n<0||n>255)) return false;
  return p[0]===10 || p[0]===127 || (p[0]===192&&p[1]===168) || (p[0]===172&&p[1]>=16&&p[1]<=31);
}
