// Uses only randomly named disposable containers/network. No host DB, .env or volumes.
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const prefix=`nm-smoke-${randomUUID().slice(0,8)}`;
const network=prefix;
const names={db:`${prefix}-db`,backend:`${prefix}-backend`,frontend:`${prefix}-frontend`};
const created=[];
function docker(...args){
  const result=spawnSync('docker',args,{encoding:'utf8'});
  if(result.status!==0)throw new Error(`docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
async function ready(url){
  for(let attempt=0;attempt<60;attempt++){
    try{const response=await fetch(url,{signal:AbortSignal.timeout(2000)});if(response.ok)return response;}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error(`Readiness timeout: ${url}`);
}
let networkCreated=false;
try{
  docker('network','create',network);networkCreated=true;
  docker('run','-d','--name',names.db,'--network',network,'--tmpfs','/var/lib/postgresql/data',
    '-e','POSTGRES_DB=smoke','-e','POSTGRES_USER=smoke','-e','POSTGRES_PASSWORD=smoke-test-only','postgres:17-alpine');
  created.push(names.db);
  for(let attempt=0;attempt<60;attempt++){
    const result=spawnSync('docker',['exec',names.db,'pg_isready','-U','smoke','-d','smoke'],{encoding:'utf8'});
    if(result.status===0)break;
    if(attempt===59)throw new Error('Test PostgreSQL did not start');
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  docker('run','-d','--name',names.backend,'--network',network,'--network-alias','backend',
    '--read-only','--tmpfs','/tmp','--cap-drop','ALL','--security-opt','no-new-privileges:true',
    '-e','NODE_ENV=test','-e',`DATABASE_URL=postgresql://smoke:smoke-test-only@${names.db}:5432/smoke`,
    '-e',`VERIFICATION_TOKEN_SECRET=${randomUUID()}${randomUUID()}`,
    '-e','PUBLIC_WEB_URL=http://127.0.0.1','-e','RUN_MIGRATIONS_ON_START=true',
    '-e','MALWARE_SCANNER=disabled','-e','ACCOUNT_ATTACHMENT_CLEANUP_ENABLED=false',
    '-p','127.0.0.1::3000','naitimastera-backend:local');
  created.push(names.backend);
  const backendPort=docker('inspect','--format','{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}',names.backend);
  const api=`http://127.0.0.1:${backendPort}`;
  await ready(api+'/health/ready');
  assert.notEqual(docker('exec',names.backend,'id','-u'),'0');
  docker('exec',names.backend,'node','--input-type=module','-e',
    "import sharp from 'sharp'; const b=await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).webp().toBuffer();if(!b.length)process.exit(1)");
  console.log('Backend ready: migrations, non-root/read-only runtime and Linux Sharp passed.');
  // Allows the two independent image builds to finish in parallel with API checks.
  for(let attempt=0;attempt<300;attempt++){
    const image=spawnSync('docker',['image','inspect','naitimastera-frontend:local'],{encoding:'utf8'});
    if(image.status===0)break;
    if(attempt===299)throw new Error('Build naitimastera-frontend:local before running the smoke check');
    await new Promise(resolve=>setTimeout(resolve,1000));
  }

  docker('run','-d','--name',names.frontend,'--network',network,
    '--cap-drop','ALL','--security-opt','no-new-privileges:true',
    '-p','127.0.0.1::8080','naitimastera-frontend:local');
  created.push(names.frontend);
  const frontendPort=docker('inspect','--format','{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}',names.frontend);
  const web=`http://127.0.0.1:${frontendPort}`;
  await ready(web+'/healthz');
  assert.notEqual(docker('exec',names.frontend,'id','-u'),'0');
  // The nginx-only image must not contain a Node runtime or private build inputs.
  docker('exec',names.frontend,'sh','-c','! command -v node && test ! -e /app/.env && test ! -e /app/node_modules');
  for(const path of ['/','/orders/','/orders/view/?id=example','/auth/login/','/account/settings/']){
    const response=await fetch(web+path);assert.equal(response.status,200,path);
    assert.match(await response.text(),/<!DOCTYPE html>/i,path);
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  }
  const asset=await fetch(web+'/assets/logo.png');assert.equal(asset.status,200);
  assert.match(asset.headers.get('content-type'),/^image\/png/);
  assert.equal((await fetch(web+'/not-a-page/')).status,404);
  assert.equal((await fetch(web+'/.env')).status,403);
  const catalog=await fetch(web+'/api/v1/orders?limit=1&offset=1');assert.equal(catalog.status,200);
  assert.equal(catalog.headers.get('cache-control'),'no-store');
  const page=await catalog.json();assert.equal(page.limit,1);assert.equal(page.offset,1);
  assert.equal((await fetch(web+'/api/v1/auth/me')).status,401);
  assert.equal((await fetch(web+'/api/v1/auth/me',{headers:{Authorization:'Bearer smoke-invalid-token'}})).status,401);
  assert.equal((await fetch(web+'/api/v1/notification-preferences',{method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:{bidSubmitted:true,bidSelected:true,orderCompleted:true,messageReceived:true}})})).status,401);
  const submitted=await fetch(web+'/api/v1/guest-orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    email:'docker-smoke@example.com',contactName:'Тестовый заказчик',categoryId:'house-building',locationId:'ru-locality-1',
    title:'Проверка Docker-образов',description:'Синтетический заказ в отдельной временной базе.',
    budgetMinMinor:null,budgetMaxMinor:null,temporaryAttachments:[],consentVersion:'2026-01',
  })});
  assert.equal(submitted.status,202,await submitted.text());
  // nginx access log must never expose confirmation-link query tokens.
  await fetch(web+'/orders/confirm/?token=smoke-sensitive-query');
  assert.doesNotMatch(docker('logs',names.frontend),/smoke-sensitive-query/);
  assert.equal((await fetch(api+'/docs/')).status,200);
  console.log('PASS: non-root images, read-only backend, native Sharp, static routes/404/assets, API query/auth/POST/PUT, Swagger and token-safe nginx logs.');
}finally{
  for(const name of created.reverse())docker('rm','-f',name);
  if(networkCreated)docker('network','rm',network);
  console.log('Removed only disposable smoke containers/network; no existing database or storage was used.');
}
