'use client';
import Link from 'next/link';
import {createContext,useContext,useEffect,useMemo,useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import {useAuth} from './auth-provider';
import {NotificationCounter,initialCounter} from '../lib/notification-counter';
import {notificationsApi} from '../lib/notifications';
const Context=createContext<NotificationCounter|null>(null);
export function NotificationProvider({children}:{children:ReactNode}){
  const {state,controller}=useAuth();const id=state.account?.id;const active=Boolean(id&&!state.checking&&!state.busy);
  // Context changes without remounting children (email confirmation must not restart).
  const counter=useMemo(()=>new NotificationCounter(async signal=>(await controller.authorized(token=>notificationsApi.list(token,1,0,signal))).unreadCount),[controller,id]);
  useEffect(()=>{
    if(!active)return;
    const refresh=()=>{if(document.visibilityState==='visible')void counter.refresh();};refresh();
    const timer=setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);window.addEventListener('focus',refresh);
    return()=>{counter.cancel();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh);};
  },[counter,active]);
  return <Context.Provider value={counter}>{children}</Context.Provider>;
}
export function useNotificationCounter(){const counter=useContext(Context);if(!counter)throw new Error('NotificationProvider is required');return {counter,...useSyncExternalStore(counter.subscribe,counter.getSnapshot,()=>initialCounter)};}
export function NotificationBell(){
  const {state}=useAuth();const {count,error}=useNotificationCounter();if(!state.account||state.checking||state.busy)return null;
  const label=error?'Уведомления: счётчик недоступен':count===null?'Уведомления: обновляем счётчик':`Уведомления: непрочитанных ${count}`;
  return <Link href="/account/notifications/" className="notification-bell" aria-label={label} title={label}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span className="bell-caption">Уведомления</span><span className="notification-badge" aria-hidden="true">{count===null?'…':count>99?'99+':count}</span></Link>;
}
