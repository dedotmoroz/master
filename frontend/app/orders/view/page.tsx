import {Suspense} from 'react';
import {Detail} from '../../../components/detail';
export const metadata={title:'Заказ'};
export default function OrderPage(){return <Suspense fallback={<div className="empty" role="status">Загрузка записи…</div>}><Detail view="orders"/></Suspense>;}
