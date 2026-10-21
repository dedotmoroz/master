import {AuthError,assertAccount,assertAuthentication} from './auth.ts';
import type {Account,Authentication,AuthKind} from './auth.ts';
export const SESSION_KEY='naitimastera.session.v1';
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
type Transport={me:(token:string)=>Promise<Account>;confirm:(kind:AuthKind,token:string)=>Promise<Authentication>;logout:(token:string,all?:boolean)=>Promise<void>};
export type SessionState={account:Account|null;checking:boolean;busy:boolean;error:string|null};
export const initialSession:SessionState={account:null,checking:true,busy:false,error:null};
export class SessionController {
  #state:SessionState=initialSession;#token:string|null=null;#epoch=0;#listeners=new Set<()=>void>();
  #storage:()=>Storage;#transport:Transport;
  constructor(storage:()=>Storage,transport:Transport){this.#storage=storage;this.#transport=transport;}
  getSnapshot=()=>this.#state;
  subscribe=(listener:()=>void)=>{this.#listeners.add(listener);return()=>{this.#listeners.delete(listener);};};
  #update(state:SessionState){this.#state=state;for(const listener of this.#listeners)listener();}
  async restore(){
    if(this.#state.busy)return;
    const epoch=++this.#epoch;this.#update({...this.#state,checking:true,error:null});
    try{
      const token=this.#storage().getItem(SESSION_KEY);
      if(!token){if(epoch===this.#epoch){this.#token=null;this.#update({account:null,checking:false,busy:false,error:null});}return;}
      this.#token=token;const account=await this.#transport.me(token);assertAccount(account);
      if(epoch===this.#epoch)this.#update({account,checking:false,busy:false,error:null});
    }catch(error){
      if(epoch!==this.#epoch)return;
      if(error instanceof AuthError&&error.status===401){this.#token=null;try{this.#storage().removeItem(SESSION_KEY);}catch{}this.#update({account:null,checking:false,busy:false,error:'Сессия истекла. Войдите ещё раз.'});}
      else this.#update({account:null,checking:false,busy:false,error:error instanceof Error?error.message:'Не удалось восстановить вход.'});
    }
  }
  async confirm(kind:AuthKind,token:string){
    return this.establish(()=>this.#transport.confirm(kind,token));
  }
  async establish(load:()=>Promise<Authentication>){
    if(this.#state.busy)throw new Error('Дождитесь завершения предыдущего действия.');
    const epoch=++this.#epoch;this.#update({...this.#state,busy:true,error:null});
    try{
      const result=await load();assertAuthentication(result);
      try{this.#storage().setItem(SESSION_KEY,result.session.token);}catch{
        try{await this.#transport.logout(result.session.token);}catch{}
        throw new Error('Браузер запретил сохранение сессии. Разрешите хранилище сайта и запросите новую ссылку.');
      }
      if(epoch===this.#epoch){this.#token=result.session.token;this.#update({account:result.account,checking:false,busy:false,error:null});}
    }catch(error){if(epoch===this.#epoch)this.#update({...this.#state,checking:false,busy:false,error:error instanceof Error?error.message:'Не удалось подтвердить вход.'});throw error;}
  }
  async authorized<T>(operation:(token:string)=>Promise<T>):Promise<T>{
    if(!this.#token||!this.#state.account||this.#state.checking||this.#state.busy)throw new AuthError(401);
    const epoch=this.#epoch;const token=this.#token;
    try{const result=await operation(token);if(epoch!==this.#epoch||this.#token!==token)throw new Error('Сессия изменилась. Откройте заказ заново.');return result;}
    catch(error){if(epoch===this.#epoch&&error instanceof AuthError&&error.status===401){++this.#epoch;this.#token=null;try{this.#storage().removeItem(SESSION_KEY);}catch{}this.#update({account:null,checking:false,busy:false,error:'Сессия истекла. Войдите ещё раз.'});}throw error;}
  }
  async logout(all=false){
    if(this.#state.busy)return;
    if(!this.#token){this.#update({account:null,checking:false,busy:false,error:null});return;}
    const epoch=++this.#epoch;const token=this.#token;this.#update({...this.#state,busy:true,error:null});
    try{
      try{await this.#transport.logout(token,all);}catch(error){if(!(error instanceof AuthError&&error.status===401))throw error;}
      this.#storage().removeItem(SESSION_KEY);
      if(epoch===this.#epoch){this.#token=null;this.#update({account:null,checking:false,busy:false,error:null});}
    }catch(error){if(epoch===this.#epoch)this.#update({...this.#state,checking:false,busy:false,error:error instanceof Error?error.message:'Не удалось выйти.'});}
  }
}
