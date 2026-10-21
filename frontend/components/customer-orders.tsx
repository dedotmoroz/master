'use client';
import Link from 'next/link';
import {useSearchParams,useRouter} from 'next/navigation';
import {useRef,useState} from 'react';
import {useAuth} from './auth-provider';
import {useResource} from './use-resource';
import {OrderFieldsForm,fieldsFromForm} from './order-fields';
import {OrderError,UUID,buildUpdate,editable,ordersApi,ownOrderHref,statusLabel} from '../lib/orders';
import type {OwnOrder} from '../lib/orders';
import {formatBudget,paginationPages} from '../lib/catalog';
import {assertPage} from '../lib/api';
import {OrderBids} from './bids';
import {DealPanel} from './deal';
import {OrderFiles} from './order-files';
import type {OrderFile} from './order-files';
import {PublicAttachment} from './public-attachment';
import type {UpdateBody} from '../lib/orders';

function EditOrder({order,busy,onSave,onCancel}:{order:OwnOrder;busy:boolean;onSave:(body:UpdateBody)=>void;onCancel:()=>void}){
  const [files,setFiles]=useState<OrderFile[]>(()=>order.attachmentIds.map(id=>({id})));const [uploading,setUploading]=useState(false);const [error,setError]=useState('');
  return <form className="demo-form" onSubmit={event=>{event.preventDefault();if(busy||uploading)return;try{setError('');onSave(buildUpdate(fieldsFromForm(new FormData(event.currentTarget)),files.map(file=>file.id)));}catch(error){setError(error instanceof Error?error.message:'Проверьте поля.');}}}><fieldset className="form-fieldset" disabled={busy}>
    <OrderFieldsForm initial={{title:order.title,description:order.description,categoryId:order.categoryId,locationId:order.locationId,budgetMin:order.budget.minMinor===null?'':String(order.budget.minMinor/100),budgetMax:order.budget.maxMinor===null?'':String(order.budget.maxMinor/100)}}/>
    <OrderFiles files={files} onChange={setFiles} onBusy={setUploading}/><p className="field-hint">Изменения вложений применяются только после сохранения. Отклики сохранятся.</p>
    {error&&<p className="auth-error" role="alert">{error}</p>}<div className="account-actions"><button className="primary" type="submit" disabled={uploading}>{busy?'Сохраняем…':uploading?'Дождитесь проверки файла':'Сохранить изменения'}</button><button className="outline" type="button" onClick={onCancel}>Не сохранять</button></div>
  </fieldset></form>;
}

export function CustomerOrders(){
  const {state,controller}=useAuth();const params=useSearchParams();const router=useRouter();
  const candidate=Number(params.get('page')||1);const page=Number.isSafeInteger(candidate)&&candidate>=1&&candidate<=50001?candidate:1;
  const resource=useResource(`own-orders:${state.account!.id}:${page}`,async signal=>{const data=await controller.authorized(token=>ordersApi.list(token,page,signal));assertPage(data);return data;});
  const pages=resource.data?Math.min(Math.ceil(resource.data.total/20),50001):0;
  return <><div className="breadcrumbs"><Link href="/account/">Мой аккаунт</Link></div><div className="page-heading"><h1>Мои заказы</h1><Link className="outline" href="/orders/new/">Разместить заказ</Link></div>
    {resource.loading&&<div className="empty" role="status">Загружаем ваши заказы…</div>}
    {resource.error&&<div className="empty" role="alert"><p>{resource.error}</p><button className="outline" onClick={resource.reload}>Повторить</button></div>}
    {resource.data&&<><p className="card-description" role="status">Всего заказов: {resource.data.total}</p>{resource.data.items.map(order=><article className="result-card" key={order.id}><div className="card-top"><h2><Link className="title-button" href={ownOrderHref(order.id)}>{order.title}</Link></h2><span className="order-status">{statusLabel[order.status]}</span></div><p>{formatBudget(order.budget)}</p><div className="card-bottom"><span>Создан {new Date(order.createdAt).toLocaleDateString('ru-RU')}</span><Link href={ownOrderHref(order.id)}>Открыть заказ →</Link></div></article>)}
      {!resource.data.items.length&&<div className="empty"><p>{resource.data.total?'На этой странице нет заказов.':'У вас пока нет заказов. Новые заказы появляются здесь только после подтверждения email.'}</p><Link href={resource.data.total?'/account/orders/':'/orders/new/'}>{resource.data.total?'На первую страницу':'Разместить заказ'}</Link></div>}
      <nav className="pagination" aria-label="Страницы моих заказов">{paginationPages(page,pages).map(n=><Link key={n} href={`/account/orders/?page=${n}`} aria-current={page===n?'page':undefined}>{n}</Link>)}</nav>
      {pages>1&&<form className="page-jump" onSubmit={event=>{event.preventDefault();const n=Number(new FormData(event.currentTarget).get('page'));if(Number.isInteger(n)&&n>=1&&n<=pages)router.push(`/account/orders/?page=${n}`);}}><label>Перейти на страницу <input name="page" type="number" min="1" max={pages} required defaultValue={page} key={page}/></label><button className="outline">Перейти</button></form>}
    </>}
  </>;
}
export function CustomerOrderView(){const id=useSearchParams().get('id')||'';return <CustomerOrderBody key={id} id={id}/>;}
function CustomerOrderBody({id}:{id:string}){
  const {state,controller}=useAuth();const [updated,setUpdated]=useState<OwnOrder>();const [editing,setEditing]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const guard=useRef(false);const cancelDialog=useRef<HTMLDialogElement>(null);
  const resource=useResource(`own-order:${state.account!.id}:${id}`,async signal=>{if(!UUID.test(id))throw new Error('В ссылке не указан корректный идентификатор заказа.');return controller.authorized(token=>ordersApi.get(token,id,signal));});
  const order=updated||resource.data;
  async function mutate(operation:()=>Promise<OwnOrder>){
    if(guard.current)return;guard.current=true;setBusy(true);setError('');
    try{const result=await operation();setUpdated(result);setEditing(false);}catch(error){setError(error instanceof Error?error.message:'Не удалось изменить заказ.');if(error instanceof OrderError&&error.status===409){setEditing(false);setUpdated(undefined);resource.reload();}}finally{guard.current=false;setBusy(false);cancelDialog.current?.close();}
  }
  return <><div className="breadcrumbs"><Link href="/account/orders/">← Мои заказы</Link></div>
    {resource.loading&&!updated&&<div className="empty" role="status">Загружаем заказ…</div>}
    {resource.error&&!updated&&<div className="empty" role="alert"><p>{resource.error}</p><button className="outline" onClick={resource.reload}>Повторить</button></div>}
    {order&&<section className="order-panel"><div className="page-heading"><h1>{order.title}</h1><span className="order-status">{statusLabel[order.status]}</span></div>
      {editing?<EditOrder order={order} busy={busy} onSave={body=>void mutate(()=>controller.authorized(token=>ordersApi.update(token,id,body)))} onCancel={()=>{setEditing(false);setError('');}}/>:<>
        <p><strong>{formatBudget(order.budget)}</strong></p><p className="detail-text preserve-lines">{order.description}</p><p className="card-description">Вложений: {order.attachmentIds.length}. Создан {new Date(order.createdAt).toLocaleDateString('ru-RU')}.</p>
        <div className="attachment-grid">{order.attachmentIds.map((id,index)=><PublicAttachment key={id} id={id} alt={`Вложение ${index+1}`} owned/>)}</div>
        {order.status==='published'&&<p><Link href={`/orders/view/?id=${encodeURIComponent(order.id)}`}>Публичная карточка →</Link></p>}
        {editable(order.status)?<div className="account-actions"><button className="outline" disabled={busy} onClick={()=>{setError('');setEditing(true);}}>Редактировать</button><button className="outline danger" disabled={busy} onClick={()=>cancelDialog.current?.showModal()}>Отменить заказ</button></div>:<p className="field-hint">Для заказа со статусом «{statusLabel[order.status]}» редактирование и обычная отмена недоступны.</p>}
      </>}{error&&<p className="auth-error" role="alert">{error}</p>}
      <dialog ref={cancelDialog} aria-label="Подтверждение отмены заказа"><h2>Отменить заказ?</h2><p className="detail-text">Новые отклики больше не будут приниматься. Заказ останется в вашем кабинете со статусом «Отменён».</p><div className="account-actions"><button className="outline" disabled={busy} onClick={()=>cancelDialog.current?.close()}>Не отменять</button><button className="primary" disabled={busy} onClick={()=>void mutate(()=>controller.authorized(token=>ordersApi.cancel(token,id)))}>{busy?'Отменяем…':'Подтвердить отмену'}</button></div></dialog>
    </section>}
    {order&&(order.status==='in_progress'||order.status==='completed')&&<DealPanel orderId={id} embedded onChanged={()=>{setUpdated(undefined);resource.reload();}}/>}
    {order&&<OrderBids orderId={id} canSelect={order.status==='published'&&!editing&&!busy} onSelected={()=>{setUpdated(undefined);setEditing(false);resource.reload();}}/>}
  </>;
}
