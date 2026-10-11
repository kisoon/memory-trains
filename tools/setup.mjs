import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {privateAddress} from '../web/lib/protocol.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const configPath=join(root,'config/local.json');
try {await access(configPath);throw new Error('config/local.json이 이미 있습니다. 기존 설정을 직접 수정하세요.');}
catch(e){if(e.code!=='ENOENT')throw e;}
const simulation=process.argv.includes('--sim');
const q=createInterface({input:stdin,output:stdout});
try{
  let ssid='',password='',hosts=['127.0.0.1','127.0.0.1'];
  if(!simulation){
    ssid=await q.question('2.4GHz Wi-Fi 이름: ');
    password=await q.question('Wi-Fi 비밀번호 (이 터미널에 표시됩니다): ');
    for(let i=0;i<2;i++){
      hosts[i]=(await q.question('열차 '+(i+1)+' 예약 IP (예: 192.168.10.'+(101+i)+'): ')).trim();
      if(!privateAddress(hosts[i]))throw new Error('내부 IPv4 주소를 입력하세요.');
    }
  }
  const expose=simulation?false:(await q.question('휴대전화에서도 접속할까요? (y/N): ')).toLowerCase()==='y';
  const config={host:expose?'0.0.0.0':'127.0.0.1',port:3000,controlKey:randomBytes(24).toString('hex'),
    trains:[1,2].map((id,i)=>({id,host:hosts[i],port:simulation?8080+id:80,token:randomBytes(24).toString('hex')}))};
  await mkdir(join(root,'config'),{recursive:true});
  const template=await readFile(join(root,'hardware/train_controller/config.example.h'),'utf8');
  for(const t of config.trains){
    const header=template
      .replace('constexpr int TRAIN_ID = 1;','constexpr int TRAIN_ID = '+t.id+';')
      .replace(/constexpr char WIFI_SSID\[\] = .*;/,'constexpr char WIFI_SSID[] = '+JSON.stringify(ssid)+';')
      .replace(/constexpr char WIFI_PASSWORD\[\] = .*;/,'constexpr char WIFI_PASSWORD[] = '+JSON.stringify(password)+';')
      .replace(/constexpr char TRAIN_TOKEN\[\] = .*;/,'constexpr char TRAIN_TOKEN[] = '+JSON.stringify(t.token)+';');
    await writeFile(join(root,'config/train-'+t.id+'.h'),header,{mode:0o600,flag:'wx'});
  }
  await writeFile(configPath,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log('설정 생성 완료. 웹 제어 키는 config/local.json의 controlKey입니다.');
  console.log(simulation?'터미널 1: cd web && npm run simulate / 터미널 2: cd web && npm start':'node tools/select-train.mjs 1 실행 후 첫 보드 업로드. 두 번째 보드는 2를 선택.');
}finally{q.close();}
