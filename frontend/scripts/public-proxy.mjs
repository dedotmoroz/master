// A local preview convenience, not a Next API route or an open forwarding proxy.
// Only public read endpoints are allowed; cookies/authorization never pass through.
export function isPublicApiPath(path) {
  return /^\/api\/v1\/(?:orders|contractors)(?:\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?$/i.test(path)
    || /^\/api\/v1\/contractors\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/reviews$/i.test(path)
    || /^\/api\/v1\/attachments\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/(?:preview-url|download-url)$/i.test(path)
    || /^\/api\/v1\/(?:work-categories|regions|locations)$/.test(path);
}
export async function proxyPublicApi(req,res,url) {
  if(!isPublicApiPath(url.pathname)){res.writeHead(404);res.end();return;}
  const target=new URL(process.env.API_PROXY_TARGET||'http://127.0.0.1:3000');
  if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw new Error('Invalid API_PROXY_TARGET');
  try {
    const response=await fetch(new URL(url.pathname+url.search,target.origin),{method:req.method,headers:{Accept:'application/json'},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
    const body=req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(body);
  }catch{
    res.writeHead(502,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({code:'API_UNAVAILABLE'}));
  }
}
