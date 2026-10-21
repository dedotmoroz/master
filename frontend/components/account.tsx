'use client';
import Link from 'next/link';
import {useAuth} from './auth-provider';
import {LogoutAllButton} from './account-settings';
export function AccountPage(){
  const {state,controller}=useAuth();
  return <section className="auth-panel"><h1>Мой аккаунт</h1>
    {state.checking?<p role="status">Проверяем сессию…</p>:state.account?<>
      <p className="detail-text">Вы вошли как <strong>{state.account.email}</strong>.</p>
      <p className="card-description">Вход сохранён в этой вкладке и восстановится после перезагрузки. На общем компьютере используйте кнопку «Выйти».</p>
      <p className="detail-text">Права аккаунта: {state.account.capabilities.map(value=>({customer:'заказчик',contractor:'мастер',admin:'администратор'}[value])).join(', ')}.</p>
      <div className="account-actions"><button className="outline" disabled={state.busy} onClick={()=>void controller.logout()}>Выйти</button><LogoutAllButton key={state.account.id}/></div>
      <p className="detail-text"><Link href="/account/orders/">Мои заказы →</Link></p><p><Link href="/orders/new/">Разместить заказ →</Link></p>
      <p><Link href="/account/bids/">Мои отклики →</Link></p>
      <p><Link href="/account/settings/">Настройки аккаунта →</Link></p>
      <p><Link href="/account/notifications/">Уведомления →</Link></p><p><Link href="/account/notifications/settings/">Настройки email-уведомлений →</Link></p>
      <p><Link href="/account/profile/">Редактировать профиль мастера →</Link></p><p className="card-description">Переписка открывается из конкретного отклика.</p>
    </>:<><p className="detail-text">Войдите по ссылке из письма, чтобы открыть свой аккаунт.</p><Link href="/auth/login/">Войти</Link> · <Link href="/auth/register/">Зарегистрироваться</Link></>}
    {state.error&&<div className="auth-error" role="alert"><p>{state.error}</p>{!state.account&&<button className="outline" disabled={state.busy} onClick={()=>void controller.restore()}>Повторить проверку сессии</button>}</div>}
  </section>;
}
