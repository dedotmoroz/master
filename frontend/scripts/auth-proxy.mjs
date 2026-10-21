export function authRoute(path,method){
  if(method==='POST'&&/^\/api\/v1\/auth\/(?:email-change|account-deletion)-requests\/confirm$/.test(path))return 'public';
  if(method==='POST'&&/^\/api\/v1\/auth\/(?:email-change|account-deletion)-requests$/.test(path))return 'session';
  if(method==='POST'&&/^\/api\/v1\/auth\/(?:registrations|login-requests)(?:\/confirm)?$/.test(path))return 'public';
  if(method==='GET'&&path==='/api/v1/auth/me')return 'session';
  if(method==='DELETE'&&['/api/v1/auth/session','/api/v1/auth/sessions'].includes(path))return 'session';
  return null;
}
function fail(res,status){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({code:'AUTH_REQUEST_FAILED'}));}
export async function proxyAuthentication(req,res,url){
  const route=authRoute(url.pathname,req.method);
  if(!route||url.search){fail(res,404);return;}
  if(req.headers['sec-fetch-site']==='cross-site'){fail(res,403);return;}
  const origin=req.headers.origin;
  if(origin){let parsed;try{parsed=new URL(origin);}catch{fail(res,403);return;}if(parsed.host!==req.headers.host||parsed.protocol!=='http:'){fail(res,403);return;}}
  const headers={Accept:'application/json'};
  if(route==='session'){
    const value=req.headers.authorization;
    if(typeof value!=='string'||!/^Bearer [^\s\x00-\x1f]{1,2048}$/.test(value)){fail(res,401);return;}
    headers.Authorization=value;
  }
  let body;
  if(req.method==='POST'){
    if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']||'')){fail(res,415);return;}
    let size=0;const chunks=[];
    for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size<=4096)chunks.push(Buffer.from(chunk));}
    if(size>4096){fail(res,413);return;}
    body=Buffer.concat(chunks);headers['Content-Type']='application/json';
  }
  try{
    const target=new URL(process.env.API_PROXY_TARGET||'http://127.0.0.1:3000');
    if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw new Error('Invalid API_PROXY_TARGET');
    const response=await fetch(new URL(url.pathname,target.origin),{method:req.method,headers,body,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
    const data=response.status===204?undefined:Buffer.from(await response.arrayBuffer());
    const responseHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
    const retry=response.headers.get('retry-after');if(retry&&/^\d+$/.test(retry))responseHeaders['Retry-After']=retry;
    res.writeHead(response.status,responseHeaders);res.end(data);
  }catch{fail(res,502);}
}
