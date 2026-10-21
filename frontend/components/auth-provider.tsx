'use client';
import {createContext,useContext,useEffect,useState,useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import {authTransport} from '../lib/auth';
import {initialSession,SessionController} from '../lib/session';
const AuthContext=createContext<SessionController|null>(null);
export function AuthProvider({children}:{children:ReactNode}){
  const [controller]=useState(()=>new SessionController(()=>window.sessionStorage,authTransport));
  useEffect(()=>{void controller.restore();},[controller]);
  return <AuthContext.Provider value={controller}>{children}</AuthContext.Provider>;
}
export function useAuth(){
  const controller=useContext(AuthContext);if(!controller)throw new Error('AuthProvider is required');
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,()=>initialSession);
  return {state,controller};
}
