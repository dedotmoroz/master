import {Suspense} from 'react';
import {SessionGate} from '../../../components/session-gate';
import {Notifications} from '../../../components/notifications';
export const metadata={title:'Уведомления',robots:{index:false,follow:false}};
export default function Page(){return <Suspense fallback={<p role="status">Загрузка…</p>}><SessionGate><Notifications/></SessionGate></Suspense>;}
