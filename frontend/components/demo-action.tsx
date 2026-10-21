'use client';
import Link from 'next/link';
import type {ReactNode} from 'react';
import {useAuth} from './auth-provider';
// Keep the established call sites and visual classes; all actions now use real pages.
export function DemoAction({kind,className,children}:{kind:'order'|'master'|'login';className?:string;children:ReactNode}){
  const {state}=useAuth();
  const href=kind==='order'?'/orders/new/':kind==='login'?'/auth/login/':state.account?'/account/profile/':'/auth/register/';
  return <Link className={className} href={href}>{children}</Link>;
}
