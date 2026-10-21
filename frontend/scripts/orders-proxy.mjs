const id='[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
export function orderRoute(path,method){
  if(method==='GET'&&path==='/api/v1/notifications')return {session:true,body:false,query:true};
  if(['GET','PUT'].includes(method)&&path==='/api/v1/notification-preferences')return {session:true,body:method==='PUT',query:false};
  if(method==='POST'&&new RegExp(`^/api/v1/notifications/${id}/read$`,'i').test(path))return {session:true,body:false,query:false};
  if(method==='POST'&&(path==='/api/v1/guest-attachments/upload-requests'||new RegExp(`^/api/v1/guest-attachments/${id}/confirm$`,'i').test(path)))return {session:false,body:true,query:false};
  if(method==='GET'&&new RegExp(`^/api/v1/attachments/${id}/owner-(preview|download)-url$`,'i').test(path))return {session:true,body:false,query:false};
  if(path==='/api/v1/contractor/profile'&&['GET','PUT'].includes(method))return {session:true,body:method==='PUT',query:false,maxBodyBytes:524288};
  if(path==='/api/v1/attachments/upload-requests'&&method==='POST')return {session:true,body:true,query:false};
  if(method==='POST'&&new RegExp(`^/api/v1/attachments/${id}/confirm$`,'i').test(path))return {session:true,body:false,query:false};
  if(method==='GET'&&new RegExp(`^/api/v1/orders/${id}/deal$`,'i').test(path))return {session:true,body:false,query:false};
  if(method==='POST'&&new RegExp(`^/api/v1/orders/${id}/(complete|reviews)$`,'i').test(path))return {session:true,body:path.endsWith('/reviews'),query:false};
  if(['GET','POST'].includes(method)&&new RegExp(`^/api/v1/bids/${id}/messages$`,'i').test(path))return {session:true,body:method==='POST',query:method==='GET'};
  if(method==='POST'&&new RegExp(`^/api/v1/orders/${id}/bids$`,'i').test(path))return {session:true,body:true,query:false};
  if(method==='GET'&&(path==='/api/v1/contractor/bids'||new RegExp(`^/api/v1/customer/orders/${id}/bids$`,'i').test(path)))return {session:true,body:false,query:true};
  if(method==='POST'&&(new RegExp(`^/api/v1/contractor/bids/${id}/withdraw$`,'i').test(path)||new RegExp(`^/api/v1/customer/orders/${id}/bids/${id}/select$`,'i').test(path)))return {session:true,body:false,query:false};
  if(method==='POST'&&['/api/v1/guest-orders','/api/v1/guest-orders/confirm'].includes(path))return {session:false,body:true,query:false};
  if(method==='GET'&&path==='/api/v1/customer/orders')return {session:true,body:false,query:true};
  if(['GET','PUT'].includes(method)&&new RegExp(`^/api/v1/customer/orders/${id}$`,'i').test(path))return {session:true,body:method==='PUT',query:false};
  if(method==='POST'&&new RegExp(`^/api/v1/customer/orders/${id}/cancel$`,'i').test(path))return {session:true,body:false,query:false};
  return null;
}
function fail(res,status){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({code:'ORDER_REQUEST_FAILED'}));}
export async function proxyOrders(req,res,url){
  const route=orderRoute(url.pathname,req.method);
  if(!route||(url.search&&(!route.query||[...url.searchParams.keys()].some(key=>!['limit','offset'].includes(key))))){fail(res,404);return;}
  if(req.headers['sec-fetch-site']==='cross-site'){fail(res,403);return;}
  if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{fail(res,403);return;}if(origin.host!==req.headers.host||origin.protocol!=='http:'){fail(res,403);return;}}
  const headers={Accept:'application/json'};
  if(route.session){const auth=req.headers.authorization;if(typeof auth!=='string'||!/^Bearer [^\s\x00-\x1f]{1,2048}$/.test(auth)){fail(res,401);return;}headers.Authorization=auth;}
  let body;
  if(route.body){
    if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']||'')){fail(res,415);return;}
    const maximum=route.maxBodyBytes||65536;let size=0;const chunks=[];for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size<=maximum)chunks.push(Buffer.from(chunk));}
    if(size>maximum){fail(res,413);return;}body=Buffer.concat(chunks);headers['Content-Type']='application/json';
  }
  try{
    const target=new URL(process.env.API_PROXY_TARGET||'http://127.0.0.1:3000');
    if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw new Error('Invalid API_PROXY_TARGET');
    const upstream=await fetch(new URL(url.pathname+url.search,target.origin),{method:req.method,headers,body,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
    const data=Buffer.from(await upstream.arrayBuffer());const output={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
    const retry=upstream.headers.get('retry-after');if(retry&&/^\d+$/.test(retry))output['Retry-After']=retry;
    res.writeHead(upstream.status,output);res.end(data);
  }catch{fail(res,502);}
}
