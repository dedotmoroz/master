import {Suspense} from 'react';
import {SessionGate} from '../../../../components/session-gate';
import {DealPage} from '../../../../components/deal';
export const metadata={title:'Работа и отзыв',robots:{index:false,follow:false}};
export default function Deal(){return <Suspense fallback={<p role="status">Загрузка…</p>}><SessionGate><DealPage/></SessionGate></Suspense>;}
