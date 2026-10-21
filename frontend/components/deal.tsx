'use client';
import Link from 'next/link';
import {useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {useAuth} from './auth-provider';
import {useResource} from './use-resource';
import {buildReview,dealsApi} from '../lib/deals';
import {statusLabel} from '../lib/orders';
import {conversationHref} from '../lib/messages';
export function DealPage(){const id=useSearchParams().get('id')||'';return <><div className="breadcrumbs"><Link href="/account/orders/">Мои заказы</Link> · <Link href="/account/bids/">Мои отклики</Link></div><DealPanel key={id} orderId={id}/></>;}
export function DealPanel({orderId,embedded=false,onChanged}:{orderId:string;embedded?:boolean;onChanged?:()=>void}){
  const {state,controller}=useAuth();const resource=useResource(`deal:${state.account!.id}:${orderId}`,signal=>controller.authorized(token=>dealsApi.get(token,orderId,signal)));
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [score,setScore]=useState('');const [text,setText]=useState('');const guard=useRef(false);const dialog=useRef<HTMLDialogElement>(null);const deal=resource.data;
  async function mutate(operation:()=>Promise<unknown>,message:string,changed=false){
    if(guard.current)return;guard.current=true;setBusy(true);setError('');setNotice('');
    try{await operation();setNotice(message);resource.reload();if(changed)onChanged?.();}
    catch(error){setError(error instanceof Error?error.message:'Не удалось выполнить действие.');resource.reload();if(changed)onChanged?.();}
    finally{guard.current=false;setBusy(false);dialog.current?.close();}
  }
  return <section className="order-panel">{embedded?<h2>Завершение и отзыв</h2>:<h1>{deal?.title||'Работа и отзыв'}</h1>}
    {resource.loading&&<p role="status">Проверяем состояние сделки…</p>}{resource.error&&<p role="alert" className="auth-error">{resource.error}</p>}
    <button className="outline" disabled={busy} onClick={()=>{setError('');setNotice('');resource.reload();}}>Обновить состояние</button>
    {deal&&<><p>Статус: <strong>{statusLabel[deal.status]}</strong></p>
      <p className="field-hint">{state.account!.id===deal.customerId?'Вы — заказчик. Отзыв будет о выбранном мастере.':'Вы — выбранный исполнитель. Отзыв будет о заказчике.'}</p>
      {deal.contractorId&&<p><Link href={`/masters/view/?id=${encodeURIComponent(deal.contractorId)}`}>Профиль мастера →</Link></p>}
      {deal.selectedBidId&&<p><Link href={conversationHref(deal.selectedBidId)}>Переписка по работе →</Link></p>}
      {deal.status==='in_progress'&&<><p className="detail-text">Если работа выполнена, завершите заказ. Это действие доступно обоим участникам. Вернуть заказ в работу через этот интерфейс нельзя.</p><button className="primary" disabled={busy} onClick={()=>dialog.current?.showModal()}>Завершить работу</button></>}
      {deal.status==='completed'&&<><p>Работа завершена{deal.completedAt?` ${new Date(deal.completedAt).toLocaleDateString('ru-RU')}`:''}.</p>
        {deal.ownReview?<div className="result-card"><h3>Ваш отзыв сохранён</h3><p><strong>{deal.ownReview.score} / 5</strong></p><p className="detail-text preserve-lines">{deal.ownReview.text}</p><p className="field-hint">{deal.ownReview.status==='published'?'Опубликован.':deal.ownReview.status==='hidden'?'Скрыт с публичной страницы.':'Оспорен.'} Повторный отзыв по этой работе недоступен.</p></div>:<form className="demo-form" onSubmit={event=>{event.preventDefault();try{const body=buildReview(score,text);void mutate(()=>controller.authorized(token=>dealsApi.review(token,orderId,body)),'Отзыв опубликован.');}catch(error){setError(error instanceof Error?error.message:'Проверьте поля.');}}}>
          <h3>{state.account!.id===deal.customerId?'Отзыв о мастере':'Отзыв о заказчике'}</h3><fieldset className="form-fieldset" disabled={busy}><label>Оценка<select value={score} onChange={event=>setScore(event.target.value)} required><option value="">Выберите оценку</option>{[5,4,3,2,1].map(n=><option key={n} value={n}>{n} из 5</option>)}</select></label><label>Текст отзыва<textarea value={text} onChange={event=>setText(event.target.value)} required maxLength={5000} rows={5}/></label><p className="field-hint">Отзыв будет опубликован. Не указывайте личные контакты, адреса и другие конфиденциальные сведения. Изменение и удаление отзыва здесь не предусмотрены.</p><button className="primary" type="submit">{busy?'Публикуем…':'Опубликовать отзыв'}</button></fieldset>
        </form>}
      </>}
      {deal.status!=='in_progress'&&deal.status!=='completed'&&<p className="field-hint">Завершение доступно только для заказа в работе, отзыв — после завершения.</p>}
    </>}
    {error&&<p role="alert" className="auth-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <dialog ref={dialog} aria-label="Подтверждение завершения" onCancel={event=>{if(busy)event.preventDefault();}}><h2>Работа выполнена?</h2><p className="detail-text">Заказ станет завершённым. Оба участника смогут оставить по одному отзыву, а переписка станет доступна только для чтения.</p><div className="account-actions"><button className="outline" disabled={busy} onClick={()=>dialog.current?.close()}>Ещё не выполнена</button><button className="primary" disabled={busy} onClick={()=>void mutate(()=>controller.authorized(token=>dealsApi.complete(token,orderId)),'Работа завершена.',true)}>{busy?'Сохраняем…':'Подтвердить завершение'}</button></div></dialog>
  </section>;
}
