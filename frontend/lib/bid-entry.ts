import {OrderError,ordersApi} from './orders.ts';

// The public order deliberately does not disclose customerId. Check ownership
// through the existing private endpoint; only its normal 404 means "not mine".
export async function ownsOrder(token:string,id:string,signal?:AbortSignal){
  try{await ordersApi.get(token,id,signal);return true;}
  catch(error){if(error instanceof OrderError&&error.status===404)return false;throw error;}
}
export function emptyBidLink(hasOrder:boolean,total:number,firstPage:string){
  if(total>0)return {href:firstPage,label:'На первую страницу'};
  return hasOrder?null:{href:'/orders/',label:'Смотреть заказы →'};
}
