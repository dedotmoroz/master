import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {runMigrations} from '../../src/adapters/out/postgres/migrations.ts';
import {createApplication} from '../../src/app/create-application.ts';
import {loadConfig} from '../../src/app/config.ts';
import {HmacVerificationTokenService} from '../../src/adapters/out/security/crypto-services.ts';
import {authTransport,AuthError} from '../../../frontend/lib/auth.ts';
import {SessionController,SESSION_KEY} from '../../../frontend/lib/session.ts';

test('static frontend auth transport and session lifecycle match real API/Postgres', {skip:!process.env.TEST_DATABASE_URL}, async context=>{
  const schema=`frontend_auth_${randomUUID().replaceAll('-','_')}`;
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema}`);
  const pool=new Pool({connectionString:url.toString()});
  const secret='frontend-auth-test-only-secret-at-least-32-bytes';
  let app:Awaited<ReturnType<typeof createApplication>>|undefined;
  const original=globalThis.fetch;
  context.after(async()=>{globalThis.fetch=original;await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
  await runMigrations(pool,resolve('migrations'));
  app=await createApplication(loadConfig({NODE_ENV:'test',DATABASE_URL:url.toString(),VERIFICATION_TOKEN_SECRET:secret,RUN_MIGRATIONS_ON_START:'false'}));
  const server=app.server;
  globalThis.fetch=async(input,options)=>{
    const response=await server.inject({method:options?.method as 'GET'|'POST'|'DELETE',url:String(input),headers:options?.headers as Record<string,string>,...(options?.body?{payload:String(options.body)}:{})});
    return new Response(response.statusCode===204?null:response.body,{status:response.statusCode,headers:response.headers as Record<string,string>});
  };
  const memory=new Map<string,string>();
  const storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);}};
  const controller=new SessionController(()=>storage,authTransport);
  await controller.restore();assert.equal(controller.getSnapshot().account,null);
  await authTransport.request('register','frontend-auth@example.com');
  const tokens=new HmacVerificationTokenService(secret);
  async function oneUse(purpose:string){const value=await pool.query<{id:string}>('SELECT id FROM email_auth_requests WHERE email=$1 AND purpose=$2 ORDER BY created_at DESC LIMIT 1',['frontend-auth@example.com',purpose]);return tokens.issue(`email-auth:${value.rows[0]!.id}`).raw;}
  const registrationToken=await oneUse('registration');await controller.confirm('register',registrationToken);
  assert.equal(controller.getSnapshot().account?.email,'frontend-auth@example.com');assert.ok(memory.get(SESSION_KEY));
  await assert.rejects(authTransport.confirm('register',registrationToken),error=>error instanceof AuthError&&[404,409,410].includes(error.status));
  const reload=new SessionController(()=>storage,authTransport);await reload.restore();assert.ok(reload.getSnapshot().account);
  const issued=memory.get(SESSION_KEY)!;await reload.logout();assert.equal(memory.get(SESSION_KEY),undefined);
  await assert.rejects(authTransport.me(issued),error=>error instanceof AuthError&&error.status===401);
  await authTransport.request('login','frontend-auth@example.com');await controller.confirm('login',await oneUse('login'));
  const loginToken=memory.get(SESSION_KEY)!;await controller.logout(true);await assert.rejects(authTransport.me(loginToken),error=>error instanceof AuthError&&error.status===401);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM accounts')).rows[0].count,1);
  const before=(await pool.query('SELECT count(*)::int AS count FROM email_auth_requests')).rows[0].count;
  await authTransport.request('login','unknown-account@example.com');assert.equal((await pool.query('SELECT count(*)::int AS count FROM email_auth_requests')).rows[0].count,before);
});
