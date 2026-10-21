import {Suspense} from 'react';
import {SessionGate} from '../../../components/session-gate';
import {Conversation} from '../../../components/conversation';
export const metadata={title:'Переписка',robots:{index:false,follow:false}};
export default function Messages(){return <Suspense fallback={<p role="status">Загрузка…</p>}><SessionGate><Conversation/></SessionGate></Suspense>;}
