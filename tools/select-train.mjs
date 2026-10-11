import {copyFile,chmod} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const id=process.argv[2];if(!['1','2'].includes(id))throw new Error('node tools/select-train.mjs 1 또는 2');
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const dest=join(root,'hardware/train_controller/config.h');
await copyFile(join(root,'config/train-'+id+'.h'),dest);await chmod(dest,0o600);
console.log('열차 '+id+' 설정 선택 완료. Arduino IDE에서 업로드하세요.');
