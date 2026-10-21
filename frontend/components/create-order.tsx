'use client';
import Link from 'next/link';
import {useRef,useState} from 'react';
import {buildGuest,ordersApi} from '../lib/orders';
import {OrderFieldsForm,fieldsFromForm} from './order-fields';
import {useAuth} from './auth-provider';
import {OrderFiles} from './order-files';
import type {OrderFile} from './order-files';
export function CreateOrder(){
  const {state}=useAuth();
  if(state.checking)return <div className="empty" role="status">Проверяем сессию…</div>;
  return <CreateOrderForm key={state.account?.id||'guest'} email={state.account?.email||''}/>;
}
function CreateOrderForm({email}:{email:string}){
  const [files,setFiles]=useState<OrderFile[]>([]);const [uploading,setUploading]=useState(false);
  const guard=useRef(false);const [busy,setBusy]=useState(false);const [sent,setSent]=useState(false);const [error,setError]=useState('');
  return <section className="order-panel"><h1>Разместить заказ</h1>
    {sent?<div className="success" role="status"><h2>Подтвердите email</h2><p>Заказ пока не опубликован. Откройте письмо и подтвердите публикацию по ссылке.</p><p>Если письма нет, проверьте папку «Спам». В локальном режиме ссылка появляется в журнале бэкенда.</p><Link href="/account/orders/">Мои заказы</Link></div>:<>
      <p className="detail-text">Расскажите, какая работа нужна. Публикация произойдёт только после подтверждения email — даже если вы уже вошли в аккаунт.</p>
      <form className="demo-form" onSubmit={async event=>{
        event.preventDefault();if(guard.current||uploading)return;const data=new FormData(event.currentTarget);setError('');
        try{const body=buildGuest(fieldsFromForm(data),String(data.get('email')||''),String(data.get('contactName')||''),data.get('consent')==='on',files.map(file=>({attachmentId:file.id,claimToken:file.claimToken!})));guard.current=true;setBusy(true);await ordersApi.submit(body);setSent(true);setFiles([]);}
        catch(error){setError(error instanceof Error?error.message:'Не удалось отправить заказ.');}finally{guard.current=false;setBusy(false);}
      }}><fieldset disabled={busy} className="form-fieldset"><OrderFieldsForm/>
        <h2>Контактные данные</h2><label>Контактное лицо<input name="contactName" required maxLength={120} autoComplete="name"/></label><label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={email}/></label>
        <p className="field-hint">Имя и email не отображаются в публичной карточке. Проверьте email: заказ будет принадлежать аккаунту с этим адресом.</p>
        <OrderFiles files={files} onChange={setFiles} onBusy={setUploading} guest/>
        <label className="consent"><input name="consent" type="checkbox" required/><span>Подтверждаю публикацию текста заказа, фото и документов и согласен получить письмо со ссылкой подтверждения.</span></label>
        <button className="primary" type="submit" disabled={uploading}>{busy?'Отправляем…':uploading?'Дождитесь проверки файла':'Отправить на подтверждение email'}</button>
      </fieldset></form>{error&&<p className="auth-error" role="alert">{error}</p>}
      <p className="field-hint">При ошибке соединения сначала проверьте почту: запрос мог успеть обработаться. Не отправляйте одинаковый заказ повторно без необходимости.</p>
    </>}
  </section>;
}
