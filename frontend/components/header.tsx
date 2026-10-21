'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { DemoAction } from './demo-action';
import { useAuth } from './auth-provider';
import { NotificationBell } from './notification-provider';
export function Header() {
  const pathname = usePathname();
  const masters = pathname.startsWith('/masters');
  const {state}=useAuth();
  return <>
    <a className="skip-link" href="#main">К содержимому</a>
    <div className="account-bar"><div className="container account-inner"><Link className="home" href="/orders" aria-label="На главную"><Image src="/assets/bg-home.png" alt="" width={20} height={17} unoptimized/></Link><span className="preview-label">Ремонт и строительство · Россия</span><NotificationBell/><Link href={state.account||state.error?'/account/':'/auth/login/'} className="login">{state.checking?'Проверяем…':state.account?'Мой аккаунт':state.error?'Проверить вход':'Войти'}</Link></div></div>
    <header className="site-header"><div className="brand container">
      <p>Найти мастера для<br/>ремонта и строительства</p>
      <Link className="logo" href="/orders" aria-label="Найти мастера — главная"><Image src="/assets/logo.png" alt="Найти мастера" width={355} height={77} unoptimized priority/></Link>
      <p>Найти заказчика<br/>на выполнение работ</p>
    </div><div className="navigation"><div className="container navigation-inner">
      <DemoAction className="legacy-action" kind="order">Разместить заказ</DemoAction>
      <nav className="catalog-switch" aria-label="Каталог"><Link href="/orders" aria-current={!masters ? 'page' : undefined}>Заказы</Link><Link href="/masters" aria-current={masters ? 'page' : undefined}>Мастера</Link></nav>
      <DemoAction className="legacy-action" kind="master">Добавить мастера</DemoAction>
    </div></div></header>
  </>;
}
