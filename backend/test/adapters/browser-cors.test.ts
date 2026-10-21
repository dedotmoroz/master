import test from 'node:test';
import assert from 'node:assert/strict';
import {browserCorsRules} from '../../src/adapters/out/storage/browser-cors.ts';
test('browser CORS preserves existing rules and adds only exact origins and narrow methods/headers',()=>{
  const original={ID:'other',AllowedOrigins:['https://other.example'],AllowedMethods:['GET']};
  const first=browserCorsRules([original],['http://127.0.0.1:4178']);const second=browserCorsRules(first,['http://127.0.0.1:4180']);
  assert.deepEqual(second[0],original);assert.equal(second.length,2);assert.deepEqual(second[1]?.AllowedMethods,['GET','HEAD','PUT']);assert.deepEqual(second[1]?.AllowedHeaders,['content-type']);assert.equal(second[1]?.AllowedOrigins?.length,2);
  for(const origin of ['*','https://*.example.com','https://example.com/path','https://u:p@example.com','file://bad'])assert.throws(()=>browserCorsRules([], [origin]));
});
