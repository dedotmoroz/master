import {Suspense} from 'react';
import {SessionGate} from '../../../components/session-gate';
import {CustomerOrders} from '../../../components/customer-orders';
export const metadata={title:'Мои заказы',robots:{index:false,follow:false}};
export default function Orders(){return <Suspense fallback={<div className="empty" role="status">Загрузка…</div>}><SessionGate><CustomerOrders/></SessionGate></Suspense>;}
