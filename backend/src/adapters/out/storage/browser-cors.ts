import type { CORSRule } from '@aws-sdk/client-s3';
const ruleId='naitimastera-browser-uploads';
export function browserCorsRules(existing: readonly CORSRule[], origins: readonly string[]): CORSRule[] {
  if(!origins.length)throw new Error('At least one exact origin is required');
  const allowed=origins.map(value=>{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.origin!==value||value.includes('*'))throw new Error('Use an exact HTTP(S) origin without a path');return url.origin;});
  const previous=existing.find(rule=>rule.ID===ruleId);
  return [...existing.filter(rule=>rule.ID!==ruleId),{ID:ruleId,AllowedOrigins:[...new Set([...(previous?.AllowedOrigins||[]),...allowed])],AllowedMethods:['GET','HEAD','PUT'],AllowedHeaders:['content-type'],ExposeHeaders:['ETag'],MaxAgeSeconds:600}];
}
