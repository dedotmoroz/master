'use client';
import {useEffect,useState} from 'react';
export function useResource<T>(key: string, load: (signal: AbortSignal)=>Promise<T>) {
  const [retry,setRetry]=useState(0);
  const [state,setState]=useState<{key:string;retry:number;data?:T;error?:string}>();
  useEffect(()=>{
    const controller=new AbortController();
    load(controller.signal).then(data=>{if(!controller.signal.aborted)setState({key,retry,data});}).catch(error=>{if(!controller.signal.aborted)setState({key,retry,error:error instanceof Error?error.message:'Не удалось загрузить данные.'});});
    return ()=>controller.abort();
    // key represents all loader arguments. Abort superseded requests and never show stale results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key,retry]);
  const current=state?.key===key&&state.retry===retry?state:undefined;
  return {...current,loading:!current,reload:()=>setRetry(value=>value+1)};
}
