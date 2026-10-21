import {S3Client,GetBucketCorsCommand,PutBucketCorsCommand,S3ServiceException} from '@aws-sdk/client-s3';
import type {CORSRule} from '@aws-sdk/client-s3';
import {loadConfig} from '../src/app/config.ts';
import {browserCorsRules} from '../src/adapters/out/storage/browser-cors.ts';
const config=loadConfig();
const origins=process.argv.slice(2);if(!origins.length)origins.push(new URL(config.publicWebUrl).origin);
const client=new S3Client({region:config.storage.region,...(config.storage.endpoint?{endpoint:config.storage.endpoint}:{}),forcePathStyle:config.storage.forcePathStyle,credentials:{accessKeyId:config.storage.accessKeyId,secretAccessKey:config.storage.secretAccessKey}});
try{
  let existing:CORSRule[];try{existing=(await client.send(new GetBucketCorsCommand({Bucket:config.storage.bucket}))).CORSRules||[];}catch(error){if(!(error instanceof S3ServiceException&&error.name==='NoSuchCORSConfiguration'))throw error;existing=[];}
  const rules=browserCorsRules(existing,origins);await client.send(new PutBucketCorsCommand({Bucket:config.storage.bucket,CORSConfiguration:{CORSRules:rules}}));
  console.log('Browser upload CORS configured for exact origins:',origins.join(', '));
}finally{client.destroy();}
