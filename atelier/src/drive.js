// 구글 드라이브와 파일 주고받기 (서버 함수 atelier-drive 를 거친다).
//   올리기  : 서버가 만들어 준 '올릴 자리' 주소로 브라우저가 구글에 직접 올린다 (조각으로 나눠 보내고, 끊기면 이어서 보낸다)
//   내려받기: 서버 함수가 권한을 확인한 뒤 파일 내용을 흘려보내 준다
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../src/data/backend.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 서버 함수 부르기. 오류는 사용자에게 보여 줄 문장으로 던진다
export const callDrive = (db, body) => callFn(db, 'atelier-drive', body);
export async function callFn(db, name, body) {
  const { data, error } = await db.functions.invoke(name, { body });
  if (!error) return data;
  let message = '서버에 연결하지 못했습니다. 잠시 뒤 다시 해 주세요';
  try { message = (await error.context.json()).error || message; } catch { /* 기본 문장 사용 */ }
  throw new Error(message);
}

// 파일 올리기 → 기록된 파일 정보.  onProgress(0~1)
export async function uploadFile(db, assignmentId, kind, file, onProgress = () => {}) {
  const { upload_id, url, chunk } = await callDrive(db, { action: 'upload_start', assignment_id: assignmentId, kind, name: file.name, size: file.size, mime: file.type || '' });
  let offset = 0, driveId = '', stumbles = 0;
  while (!driveId) {
    const end = Math.min(offset + chunk, file.size);
    let res = null;
    try { res = await fetch(url, { method: 'PUT', headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${file.size}` }, body: file.slice(offset, end) }); }
    catch { /* 연결이 끊김: 아래에서 어디까지 올라갔는지 묻는다 */ }
    if (res?.status === 308) { offset = end; stumbles = 0; }                          // 이 조각은 받았고, 더 보내면 된다
    else if (res?.ok) { driveId = (await res.json().catch(() => ({}))).id ?? ''; if (!driveId) break; }
    else if (res && res.status >= 400 && res.status < 500) throw new Error('올리기 시간이 지났거나 거절되었습니다. 처음부터 다시 올려 주세요');
    else {
      if (++stumbles > 6) throw new Error('인터넷이 자꾸 끊겨 올리지 못했습니다. 연결을 확인하고 다시 올려 주세요');
      await sleep(1000 * stumbles);
      const st = await callDrive(db, { action: 'upload_status', upload_id });         // 어디까지 올라갔는지 묻고 거기서부터 다시
      if (st.done) driveId = st.drive_id; else offset = st.next;
    }
    onProgress(Math.min(0.99, offset / file.size));
  }
  const saved = await callDrive(db, { action: 'upload_done', upload_id, drive_id: driveId });
  onProgress(1);
  return saved;
}

// 파일 내려받기 → { name, blob }
export async function downloadFile(db, fileId, onProgress = () => {}) {
  const { data } = await db.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/atelier-drive`, {
    method: 'POST', body: JSON.stringify({ action: 'download', file_id: fileId }),
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${data.session?.access_token ?? SUPABASE_ANON_KEY}` },
  }).catch(() => null);
  if (!res) throw new Error('서버에 연결하지 못했습니다. 잠시 뒤 다시 해 주세요');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '파일을 가져오지 못했습니다');
  const total = Number(res.headers.get('x-file-size')) || 0, name = decodeURIComponent(res.headers.get('x-file-name') || '파일');
  const reader = res.body.getReader(), parts = [];
  for (let got = 0; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (total) onProgress(Math.min(1, got / total));
  }
  return { name, blob: new Blob(parts, { type: res.headers.get('content-type') || 'application/octet-stream' }) };
}
