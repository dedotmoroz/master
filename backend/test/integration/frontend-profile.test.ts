import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import sharp from 'sharp';
import {S3Client,CreateBucketCommand,DeleteBucketCommand,DeleteObjectsCommand,ListObjectsV2Command,PutBucketCorsCommand} from '@aws-sdk/client-s3';
import {createApplication} from '../../src/app/create-application.ts';
import {loadConfig} from '../../src/app/config.ts';
import {runMigrations} from '../../src/adapters/out/postgres/migrations.ts';
import {PgDatabase,PgTransactionManager} from '../../src/adapters/out/postgres/database.ts';
import {PgAttachmentRepository} from '../../src/adapters/out/postgres/repositories.ts';
import {HmacVerificationTokenService} from '../../src/adapters/out/security/crypto-services.ts';
import {S3ObjectStorage} from '../../src/adapters/out/storage/s3-object-storage.ts';
import {browserCorsRules} from '../../src/adapters/out/storage/browser-cors.ts';
import {ClamAvMalwareScanner} from '../../src/adapters/out/security/clamav-malware-scanner.ts';
import {SharpImageSanitizer} from '../../src/adapters/out/media/sharp-image-sanitizer.ts';
import {ProcessAttachmentHandler} from '../../src/modules/attachments/application/process-attachment.ts';
import {authTransport} from '../../../frontend/lib/auth.ts';
import {blankProfile,buildProfile,profileApi,ProfileError} from '../../../frontend/lib/profile.ts';
import {captureOpenApiResponseValidation} from '../helpers/openapi-response-validation.ts';
import {guestFilesApi} from '../../../frontend/lib/order-files.ts';
import {buildGuest,buildUpdate,ordersApi} from '../../../frontend/lib/orders.ts';
import {CleanupUnusedAccountAttachmentsHandler} from '../../src/modules/attachments/application/cleanup-account-attachments.ts';
import {UploadedAttachmentUsagePolicy} from '../../src/modules/attachments/application/attachments.ts';

test('frontend profile uses real PostgreSQL/S3/ClamAV: uploads, publishes, preserves files and rejects foreign/invalid files',{skip:!process.env.TEST_DATABASE_URL||!process.env.TEST_S3_ENDPOINT},async context=>{
  const schema=`frontend_profile_${randomUUID().replaceAll('-','_')}`;const bucket=`nm-profile-test-${randomUUID()}`;const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
  const dbUrl=new URL(process.env.TEST_DATABASE_URL!);dbUrl.searchParams.set('options',`-c search_path=${schema}`);const pool=new Pool({connectionString:dbUrl.toString()});
  const storageConfig={endpoint:process.env.TEST_S3_ENDPOINT!,region:'us-east-1',bucket,accessKeyId:'minioadmin',secretAccessKey:'minioadmin',forcePathStyle:true};
  const client=new S3Client({endpoint:storageConfig.endpoint,region:storageConfig.region,credentials:{accessKeyId:storageConfig.accessKeyId,secretAccessKey:storageConfig.secretAccessKey},forcePathStyle:true});const storage=new S3ObjectStorage(storageConfig);const original=globalThis.fetch;let app:Awaited<ReturnType<typeof createApplication>>|undefined;let created=false;
  context.after(async()=>{globalThis.fetch=original;await app?.close();storage.destroy();if(created){const files=await client.send(new ListObjectsV2Command({Bucket:bucket}));const objects=files.Contents?.flatMap(item=>item.Key?[{Key:item.Key}]:[])||[];if(objects.length)await client.send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Objects:objects}}));await client.send(new DeleteBucketCommand({Bucket:bucket}));}client.destroy();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
  await client.send(new CreateBucketCommand({Bucket:bucket}));created=true;await client.send(new PutBucketCorsCommand({Bucket:bucket,CORSConfiguration:{CORSRules:browserCorsRules([],['http://127.0.0.1:4180'])}}));
  await runMigrations(pool,resolve('migrations'));const secret='frontend-profile-test-secret-at-least-32-bytes';
  app=await createApplication(loadConfig({NODE_ENV:'test',DATABASE_URL:dbUrl.toString(),VERIFICATION_TOKEN_SECRET:secret,RUN_MIGRATIONS_ON_START:'false',STORAGE_ENDPOINT:storageConfig.endpoint,STORAGE_BUCKET:bucket}));const server=app.server;const verify=captureOpenApiResponseValidation(server);context.after(()=>verify());
  globalThis.fetch=async(input,options)=>{if(!String(input).startsWith('/api/'))return original(input,options);const response=await server.inject({method:options?.method as 'GET'|'POST'|'PUT',url:String(input),headers:options?.headers as Record<string,string>,...(options?.body?{payload:String(options.body)}:{})});return new Response(response.body,{status:response.statusCode,headers:response.headers as Record<string,string>});};
  async function register(email:string){await authTransport.request('register',email);const row=await pool.query<{id:string}>('SELECT id FROM email_auth_requests WHERE email=$1',[email]);return authTransport.confirm('register',new HmacVerificationTokenService(secret).issue(`email-auth:${row.rows[0]!.id}`).raw);}
  const owner=await register('profile-owner@example.com'),other=await register('profile-other@example.com');const token=owner.session.token;assert.equal(await profileApi.get(token),null);
  const database=new PgDatabase(pool);const processor=new ProcessAttachmentHandler({attachments:new PgAttachmentRepository(database),storage,scanner:new ClamAvMalwareScanner({host:'127.0.0.1',port:Number(process.env.TEST_CLAMAV_PORT||53310),timeoutMs:30000}),images:new SharpImageSanitizer(),transactions:new PgTransactionManager(database),clock:{now:()=>new Date()}});
  const png=await sharp({create:{width:12,height:12,channels:3,background:'#287ca9'}}).png().toBuffer();
  const file=new File([new Uint8Array(png)],'photo.png',{type:'image/png'});const ticket=await profileApi.uploadRequest(token,file,'profile_avatar');
  const preflight=await original(ticket.uploadUrl,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:4180','Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'content-type'}});assert.equal(preflight.headers.get('access-control-allow-origin'),'http://127.0.0.1:4180');
  await profileApi.put(ticket,file);assert.equal((await profileApi.confirm(token,ticket.attachment.id)).status,'processing');
  const body=buildProfile({...blankProfile(),displayName:'Тестовая бригада',bio:'Опыт',specializationIds:['house-building'],serviceLocationIds:['ru-locality-1','ru-region-1'],avatarAttachmentId:ticket.attachment.id});
  await assert.rejects(profileApi.save(token,body),e=>e instanceof ProfileError&&e.code==='ATTACHMENT_NOT_USABLE');
  await processor.execute(ticket.attachment.id);assert.equal((await profileApi.confirm(token,ticket.attachment.id)).status,'ready');
  assert.equal((await server.inject({method:'GET',url:`/api/v1/attachments/${ticket.attachment.id}/preview-url`})).statusCode,404);
  const portfolio=await profileApi.uploadRequest(token,file,'portfolio');await profileApi.put(portfolio,file);await profileApi.confirm(token,portfolio.attachment.id);await processor.execute(portfolio.attachment.id);
  const saved=await profileApi.save(token,buildProfile({...body,portfolio:[{title:'Проект',description:'Описание',attachmentIds:[portfolio.attachment.id]}]}));assert.equal(saved.accountId,owner.account.id);
  const reread=await profileApi.get(token);assert.equal(reread?.portfolio[0]?.attachmentIds[0],portfolio.attachment.id);
  const edited=await profileApi.save(token,buildProfile({...saved,displayName:'Новое имя'}));assert.equal(edited.avatarAttachmentId,ticket.attachment.id);assert.deepEqual(edited.serviceLocationIds,body.serviceLocationIds);assert.deepEqual(edited.portfolio,saved.portfolio);
  await assert.rejects(profileApi.save(other.session.token,body),e=>e instanceof ProfileError&&e.code==='ATTACHMENT_NOT_USABLE');await assert.rejects(profileApi.confirm(other.session.token,ticket.attachment.id),e=>e instanceof ProfileError&&e.status===404);
  const publicImage=await server.inject({method:'GET',url:`/api/v1/attachments/${ticket.attachment.id}/preview-url`});assert.equal(publicImage.statusCode,200);const image=await original(publicImage.json().url);assert.equal(image.status,200);assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format,'webp');
  const invalid=new File(['not an image'],'fake.png',{type:'image/png'});const rejected=await profileApi.uploadRequest(token,invalid,'profile_avatar');await profileApi.put(rejected,invalid);await profileApi.confirm(token,rejected.attachment.id);await processor.execute(rejected.attachment.id);assert.equal((await profileApi.confirm(token,rejected.attachment.id)).status,'rejected');
  await assert.rejects(profileApi.save(token,{...body,avatarAttachmentId:rejected.attachment.id}),e=>e instanceof ProfileError&&e.code==='ATTACHMENT_NOT_USABLE');
  assert.equal((await profileApi.get(token))?.avatarAttachmentId,ticket.attachment.id);

  // Guest file is private until the email claim transfers ownership and publishes the order.
  const guest=await guestFilesApi.request(file);await profileApi.put(guest,file);
  await assert.rejects(guestFilesApi.confirm({...guest,claimToken:'wrong'}));
  assert.equal((await guestFilesApi.confirm(guest)).status,'processing');await processor.execute(guest.attachment.id);
  assert.equal((await guestFilesApi.confirm(guest)).status,'ready');
  const fields={title:'Заказ с фото и PDF',description:'Реальная загрузка',categoryId:'house-building',locationId:'ru-locality-1',budgetMin:'',budgetMax:''};
  const pending=await ordersApi.submit(buildGuest(fields,owner.account.email,'Заказчик',true,[{attachmentId:guest.attachment.id,claimToken:guest.claimToken}]));
  assert.equal((await server.inject({method:'GET',url:`/api/v1/attachments/${guest.attachment.id}/download-url`})).statusCode,404);
  const confirmed=await ordersApi.confirm(new HmacVerificationTokenService(secret).issue(pending.submissionId).raw);
  assert.equal(confirmed.accountId,owner.account.id);
  assert.equal((await ordersApi.get(token,confirmed.orderId)).attachmentIds[0],guest.attachment.id);
  assert.equal((await server.inject({method:'GET',url:`/api/v1/attachments/${guest.attachment.id}/preview-url`})).statusCode,200);
  const pdfFile=new File(['%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF'],'estimate.pdf',{type:'application/pdf'});
  const pdf=await profileApi.uploadRequest(token,pdfFile,'order');await profileApi.put(pdf,pdfFile);await profileApi.confirm(token,pdf.attachment.id);await processor.execute(pdf.attachment.id);
  const ownHeaders={authorization:`Bearer ${token}`};
  assert.equal((await server.inject({method:'GET',url:`/api/v1/attachments/${pdf.attachment.id}/owner-download-url`})).statusCode,401);
  assert.equal((await server.inject({method:'GET',url:`/api/v1/attachments/${pdf.attachment.id}/owner-download-url`,headers:{authorization:`Bearer ${other.session.token}`}})).statusCode,404);
  const privatePdf=await server.inject({method:'GET',url:`/api/v1/attachments/${pdf.attachment.id}/owner-download-url`,headers:ownHeaders});assert.equal(privatePdf.statusCode,200);
  assert.equal((await original(privatePdf.json().url)).headers.get('content-disposition')?.startsWith('attachment'),true);
  await ordersApi.update(token,confirmed.orderId,buildUpdate(fields,[guest.attachment.id,pdf.attachment.id]));
  assert.equal((await server.inject({method:'GET',url:`/api/v1/attachments/${pdf.attachment.id}/download-url`})).statusCode,200);
  // Draft/private and cancelled references must also survive account cleanup.
  await pool.query("UPDATE orders SET status='draft',published_at=NULL WHERE id=$1",[confirmed.orderId]);
  assert.equal((await server.inject({method:'GET',url:`/api/v1/attachments/${guest.attachment.id}/preview-url`})).statusCode,404);
  assert.equal((await server.inject({method:'GET',url:`/api/v1/attachments/${guest.attachment.id}/owner-preview-url`,headers:ownHeaders})).statusCode,200);

  const unused=await profileApi.uploadRequest(token,file,'profile_avatar');await profileApi.put(unused,file);await profileApi.confirm(token,unused.attachment.id);await processor.execute(unused.attachment.id);
  const legacy=await profileApi.uploadRequest(token,file,'profile_avatar');
  await pool.query("UPDATE attachments SET storage_key='legacy/keep-original',unreferenced_since=now()-interval '5 days' WHERE id=$1",[legacy.attachment.id]);
  const repository=new PgAttachmentRepository(database);const future=new Date(Date.now()+3*86400000);
  const cleanup=new CleanupUnusedAccountAttachmentsHandler({attachments:repository,unused:repository,storage,transactions:new PgTransactionManager(database),clock:{now:()=>future}});
  assert.equal(await cleanup.execute('test'),0,'observation starts a new retention period');
  await pool.query("UPDATE attachments SET unreferenced_since=$1 WHERE unreferenced_since IS NOT NULL",[new Date(future.getTime()-2*86400000)]);

  // Saver holds the attachment lock first: cleaner skips it; committed reference survives.
  let unlock!:()=>void;let locked!:()=>void;const ready=new Promise<void>(resolve=>{locked=resolve;});const release=new Promise<void>(resolve=>{unlock=resolve;});
  const saving=database.transaction(async()=>{await new UploadedAttachmentUsagePolicy(repository).assertUsable(owner.account.id,[unused.attachment.id],'profile_avatar');locked();await release;await database.query('UPDATE contractor_profiles SET avatar_attachment_id=$1 WHERE account_id=$2',[unused.attachment.id,owner.account.id]);});
  await ready;try{await cleanup.execute('concurrent');}finally{unlock();}await saving;
  assert.ok(await repository.findById(unused.attachment.id));
  assert.ok(await repository.findById(guest.attachment.id));assert.ok(await repository.findById(pdf.attachment.id));assert.ok(await repository.findById(legacy.attachment.id));
  assert.equal((await storage.stat(`processed-attachments/${unused.attachment.id}/image.webp`))!==null,true);

  // Cleaner wins the lock first: a concurrent bind fails, and partial S3 failures retry safely.
  await profileApi.save(token,{...body,avatarAttachmentId:ticket.attachment.id});
  await cleanup.execute('observe-again');await pool.query('UPDATE attachments SET unreferenced_since=$1 WHERE id=$2',[new Date(future.getTime()-2*86400000),unused.attachment.id]);
  let fail=true;const wrappedStorage={createUploadUrl:storage.createUploadUrl.bind(storage),stat:storage.stat.bind(storage),get:storage.get.bind(storage),put:storage.put.bind(storage),createDownloadUrl:storage.createDownloadUrl.bind(storage),delete:async(key:string)=>{
    if(fail){fail=false;await assert.rejects(profileApi.save(token,{...body,avatarAttachmentId:unused.attachment.id}),e=>e instanceof ProfileError&&e.code==='ATTACHMENT_NOT_USABLE');throw new Error('simulated storage failure');}
    await storage.delete(key);
  }};
  const retryCleanup=new CleanupUnusedAccountAttachmentsHandler({attachments:repository,unused:repository,storage:wrappedStorage,transactions:new PgTransactionManager(database),clock:{now:()=>future}});
  await assert.rejects(retryCleanup.execute('fail'),/simulated/);assert.equal((await repository.findById(unused.attachment.id))?.status,'cleanup_pending');
  assert.equal(await retryCleanup.execute('retry'),1);assert.equal(await repository.findById(unused.attachment.id),null);
  assert.equal(await storage.stat(`processed-attachments/${unused.attachment.id}/image.webp`),null);assert.equal(await storage.stat(`processed-attachments/${unused.attachment.id}/preview.webp`),null);
  await ordersApi.cancel(token,confirmed.orderId);await cleanup.execute('cancelled');assert.ok(await repository.findById(pdf.attachment.id));
});
