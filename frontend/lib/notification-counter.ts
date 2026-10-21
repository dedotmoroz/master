export type CounterState=Readonly<{count:number|null;error:string|null}>;
export const initialCounter:CounterState={count:null,error:null};
// A force refresh after a mutation supersedes older reads, including slow polling.
export class NotificationCounter{
  #state=initialCounter;#listeners=new Set<()=>void>();#abort:AbortController|undefined;#epoch=0;#inFlight=false;
  readonly #load:(signal:AbortSignal)=>Promise<number>;
  constructor(load:(signal:AbortSignal)=>Promise<number>){this.#load=load;}
  getSnapshot=()=>this.#state;
  subscribe=(listener:()=>void)=>{this.#listeners.add(listener);return()=>{this.#listeners.delete(listener);};};
  #update(state:CounterState){this.#state=state;for(const listener of this.#listeners)listener();}
  cancel(){++this.#epoch;this.#abort?.abort();this.#inFlight=false;}
  async refresh(force=false){
    if(this.#inFlight&&!force)return;
    this.cancel();const epoch=this.#epoch;const abort=new AbortController();this.#abort=abort;this.#inFlight=true;
    try{const count=await this.#load(abort.signal);if(!Number.isSafeInteger(count)||count<0)throw new Error('Некорректный счётчик уведомлений.');if(epoch===this.#epoch)this.#update({count,error:null});}
    catch(error){if(epoch===this.#epoch&&!abort.signal.aborted)this.#update({count:null,error:error instanceof Error?error.message:'Счётчик уведомлений недоступен.'});}
    finally{if(epoch===this.#epoch)this.#inFlight=false;}
  }
}
