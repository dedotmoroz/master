import {SessionGate} from '../../../components/session-gate';
import {ProfileEditor} from '../../../components/profile-editor';
export const metadata={title:'Профиль мастера',robots:{index:false,follow:false}};
export default function Profile(){return <SessionGate><ProfileEditor/></SessionGate>;}
