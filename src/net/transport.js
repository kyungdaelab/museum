// 전시실별 통신 통로. 전시실마다 통로가 따로라서 다른 전시실 접속자와는 아무것도 주고받지 않는다.
//   Supabase 설정이 있으면 → Supabase Realtime (인터넷의 다른 기기와 연결)
//   없으면               → BroadcastChannel (같은 브라우저의 탭끼리만. 시험용)
// 공통 사용법: const t = await openTransport(roomId, myId);  t.send(type, payload);  t.onMessage = (type, payload, from) => …;  t.close();
import { getClient } from '../data/backend.js';

export async function openTransport(roomId, myId) {
  const client = await getClient().catch(() => null);
  const t = { onMessage: null, kind: client ? 'supabase' : 'local' };
  const receive = (m) => { if (m && m.from !== myId && (!m.to || m.to === myId)) t.onMessage?.(m.type, m.payload, m.from); };

  if (client) {
    const channel = client.channel('room:' + roomId, { config: { broadcast: { self: false } } });
    channel.on('broadcast', { event: 'm' }, ({ payload }) => receive(payload));
    await new Promise((resolve) => channel.subscribe((status) => { if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve(); }));
    t.send = (type, payload, to) => { channel.send({ type: 'broadcast', event: 'm', payload: { from: myId, to, type, payload } }); };
    t.close = () => { client.removeChannel(channel); };
  } else {
    const channel = new BroadcastChannel('vmuseum-room:' + roomId);
    channel.onmessage = (e) => receive(e.data);
    t.send = (type, payload, to) => channel.postMessage({ from: myId, to, type, payload });
    t.close = () => channel.close();
  }
  return t;
}
