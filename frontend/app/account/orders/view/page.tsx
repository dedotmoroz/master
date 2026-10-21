import {Suspense} from 'react';
import {SessionGate} from '../../../../components/session-gate';
import {CustomerOrderView} from '../../../../components/customer-orders';
export const metadata={title:'Мой заказ',robots:{index:false,follow:false}};
export default function Order(){return <Suspense fallback={<div className="empty" role="status">Загрузка…</div>}><SessionGate><CustomerOrderView/></SessionGate></Suspense>;}
