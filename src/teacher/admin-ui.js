// 관리자 화면: 승인 대기 목록, 교사별 전시실 수 · 용량, 전체 저장 용량 그래프, 운영 규칙, 전시실 비공개 처리
import { $, el, button, field, input, run, message, dialog, confirmBox, mb, VISIBILITY, TYPE_LABEL } from './dom.js';
import { showShare } from '../ui/dialogs.js';

const siteUrl = location.origin + location.pathname.replace(/teacher\.html$/, '');
const roomUrl = (room) => `${siteUrl}?room=${encodeURIComponent(room.id)}`;

export function createAdminUi({ api }) {
  const view = $('adminView');
  let me = null;            // 지금 로그인한 내 계정 id

  async function refresh() {
    const [teachers, usage, settings, rooms, session] = await Promise.all([api.adminOverview(), api.storageUsage(), api.getSettings(), api.adminRooms(), api.session()]);
    me = session?.id ?? null;
    view.replaceChildren();

    // ── 승인 대기 ──
    const waiting = teachers.filter((t) => !t.approved), sec1 = el('section');
    sec1.append(el('h2', null, `승인 대기 ${waiting.length}명`));
    if (!waiting.length) sec1.append(el('p', 'muted', '승인을 기다리는 교사가 없습니다.'));
    for (const t of waiting) {
      const row = el('div', 'row between line');
      row.append(el('span', null, `${t.name || '(이름 없음)'} · ${t.school || '학교 미입력'} · ${t.email ?? ''}`), button('승인', 'small', (b) => run(b, async () => { await api.setApproved(t.teacher_id, true); message(`${t.name} 선생님을 승인했습니다.`); await refresh(); })));
      sec1.append(row);
    }
    view.append(sec1);

    // ── 전체 저장 용량 (무료 1GB 기준) ──
    const sec2 = el('section'), stored = Number(usage.stored_mb ?? usage.used_mb), limit = Number(usage.free_limit_mb) || 1024, pct = Math.min(100, stored / limit * 100);
    const big = el('div', 'usage'), fill = el('i'); fill.style.width = pct + '%'; if (pct >= 85) fill.className = 'full'; big.append(fill);
    sec2.append(el('h2', null, '전체 저장 용량'), big,
      el('p', null, `${mb(stored)}MB / ${mb(limit)}MB 사용 (${pct.toFixed(1)}%) · 전시실 ${usage.room_count}개 · 작품 ${usage.artwork_count}개`),
      el('p', 'muted', '무료 저장 용량 1GB 기준입니다. 900MB 에 닿으면 새 업로드가 자동으로 막힙니다(관람은 계속 됩니다).'
        + (usage.stored_mb != null && Math.abs(Number(usage.stored_mb) - Number(usage.used_mb)) > 5 ? ` 작품 기록 합계는 ${mb(usage.used_mb)}MB 로 실제와 다릅니다. 올리다 만 파일이 남아 있을 수 있습니다.` : '')));
    // 교사별 막대 그래프
    const chart = el('div', 'chart'), max = Math.max(1, ...teachers.map((t) => Number(t.used_mb)));
    for (const t of teachers.filter((x) => x.approved).sort((a, b) => b.used_mb - a.used_mb)) {
      const row = el('div', 'cRow'), bar = el('div', 'cBar'), f = el('i'); f.style.width = Number(t.used_mb) / max * 100 + '%'; bar.append(f);
      row.append(el('span', 'cName', t.name || t.email), bar, el('span', 'num', `${mb(t.used_mb)}MB`)); chart.append(row);
    }
    sec2.append(el('h3', null, '교사별 사용량'), chart);
    view.append(sec2);

    // ── 교사 목록 ──
    const sec3 = el('section'), table = el('table'), body = el('tbody');
    table.innerHTML = '<thead><tr><th>이름</th><th>학교</th><th>역할</th><th>전시실</th><th>작품</th><th>용량</th><th></th></tr></thead>';
    for (const t of teachers.filter((x) => x.approved)) {
      const tr = el('tr'), act = el('td');
      if (t.teacher_id !== me) act.append(button('관리', 'small light', () => manage(t)));
      tr.append(el('td', null, t.name + (t.teacher_id === me ? ' (나)' : '')), el('td', 'muted', t.school), el('td', null, t.role === 'admin' ? '관리자' : '교사'),
        el('td', null, `${t.room_count} / ${settings.max_rooms_per_teacher}`), el('td', null, t.artwork_count), el('td', null, `${mb(t.used_mb)}MB`), act);
      body.append(tr);
    }
    table.append(body); sec3.append(el('h2', null, '교사'), table, el('p', 'muted', '"관리"를 누르면 관리자 지정 · 관리자 넘기기 · 전시실과 학급 넘겨받기 · 계정 지우기를 할 수 있습니다.')); view.append(sec3);

    // ── 운영 규칙 ──
    const sec4 = el('section'), n = input('number', settings.max_rooms_per_teacher, { min: 1, max: 50 }), flat = input('number', settings.default_limit_flat_mb, { min: 1, max: 1024 }), scu = input('number', settings.default_limit_sculpture_mb, { min: 1, max: 1024 });
    const row = el('div', 'row');
    row.append(field('교사 1인당 최대 전시실 수', n), field('평면 전시실 기본 용량(MB)', flat), field('입체 전시실 기본 용량(MB)', scu),
      button('규칙 저장', '', (b) => run(b, async () => { await api.saveSettings({ max_rooms_per_teacher: +n.value, default_limit_flat_mb: +flat.value, default_limit_sculpture_mb: +scu.value }); message('운영 규칙을 저장했습니다. 이후에 만드는 전시실부터 적용됩니다.'); })));
    sec4.append(el('h2', null, '운영 규칙'), row, el('p', 'muted', '기본 용량은 새로 만드는 전시실에 적용됩니다. 이미 만든 전시실의 한도는 바뀌지 않습니다. 전체 무료 용량이 1GB 이므로, 교사 수 × 전시실 수 × 용량이 1GB 를 크게 넘지 않게 잡는 것을 권합니다.'));
    view.append(sec4);

    // ── 전시실 (문제 있는 전시실 비공개 처리) ──
    const sec5 = el('section'), names = new Map(teachers.map((t) => [t.teacher_id, t.name]));
    sec5.append(el('h2', null, `전체 전시실 ${rooms.length}개`), el('p', 'muted', '공개 · 링크 공유 · 학급 전용 · 비공개 전시실이 모두 나옵니다. 다른 선생님의 전시실도 주소와 QR 을 다시 받거나 삭제할 수 있습니다.'));
    for (const r of rooms) {
      const line = el('div', 'row between line'), acts = el('div', 'row');
      acts.append(button('주소 · QR', 'small light', () => showShare(r.title, roomUrl(r))), button('입장', 'small light', () => window.open(roomUrl(r), '_blank')));
      if (r.owner_id !== me) acts.append(button('넘겨받기', 'small light', async (b) => {
        if (!await confirmBox(`'${r.title}' 전시실을 내 전시실로 가져올까요?\n작품은 그대로이고, 담당이 ${names.get(r.owner_id) ?? '다른 선생님'}에서 나로 바뀝니다. "내 전시실" 탭에서 작품을 관리할 수 있게 됩니다.`, '넘겨받기')) return;
        await run(b, async () => { await api.adminTakeRoom(r.id); message(`'${r.title}' 전시실을 넘겨받았습니다.`); await refresh(); });
      }));
      acts.append(button(r.blocked ? '막기 해제' : '비공개 처리', 'small light', (b) => (r.blocked ? run(b, async () => { await api.setBlocked(r.id, false); await refresh(); }) : block(r))),
        button('삭제', 'small danger', async (b) => {
          if (!await confirmBox(`'${r.title}' 전시실을 삭제할까요?\n작품과 올린 파일이 모두 지워지고 되돌릴 수 없습니다.` + (r.owner_id !== me ? `\n\n${names.get(r.owner_id) ?? '다른 선생님'}의 전시실입니다.` : ''), '삭제')) return;
          await run(b, async () => { await api.deleteRoom(r.id); message(`'${r.title}' 전시실을 삭제했습니다.`); await refresh(); });
        }));
      line.append(el('span', null, `${r.title} · ${TYPE_LABEL[r.type]} · ${VISIBILITY[r.visibility]} · ${names.get(r.owner_id) ?? ''}${r.owner_id === me ? ' (나)' : ''} · ${mb(r.storage_used_mb)}MB` + (r.blocked ? ` · 막힘(${r.blocked_reason || '사유 없음'})` : '')), acts);
      sec5.append(line);
    }
    view.append(sec5);
  }

  // 교사 한 명 관리: 역할 바꾸기 · 관리자 넘기기 · 전시실과 학급 넘겨받기 · 승인 취소 · 계정 지우기
  function manage(t) {
    return dialog((panel, close) => {
      const admin = t.role === 'admin', who = `${t.name || '(이름 없음)'} 선생님`;
      const item = (label, cls, note, work, ask = '') => {
        const row = el('div', 'row between line'), text = el('div');
        text.append(el('b', null, label), el('p', 'muted', note));
        row.append(text, button(label, 'small ' + cls, async (b) => {
          if (ask && !await confirmBox(ask, label)) return;
          await run(b, async () => { const said = await work(); close(true); message(said); await refresh(); });
        }));
        return row;
      };
      panel.append(el('h2', null, who), el('p', 'muted', `${admin ? '관리자' : '교사'} · 전시실 ${t.room_count}개 · 작품 ${t.artwork_count}개`),
        admin
          ? item('관리자 해제', 'light', '이 계정을 보통 교사로 바꿉니다.', async () => { await api.adminSetRole(t.teacher_id, 'teacher'); return `${who}을 교사로 바꿨습니다.`; })
          : item('관리자로 지정', 'light', '이 계정도 관리자가 됩니다. 나도 관리자로 남습니다.', async () => { await api.adminSetRole(t.teacher_id, 'admin'); return `${who}을 관리자로 지정했습니다.`; }),
        item('관리자 넘기기', 'light', '이 계정을 관리자로 올리고, 나는 보통 교사로 내려옵니다.', async () => { await api.adminHandOver(t.teacher_id); return `관리자를 ${who}에게 넘겼습니다. 새로 고치면 관리자 탭이 보이지 않습니다.`; },
          `관리자를 ${who}에게 넘길까요?\n넘긴 뒤에는 내 계정에서 관리자 탭이 사라지고, 되돌리려면 ${who}이 다시 지정해 주어야 합니다.`),
        item('모두 넘겨받기', 'light', '이 계정의 전시실 · 학급(학생 포함) · 훈장 · 과제 · 공지를 모두 내 계정으로 옮깁니다. 드라이브 연결은 옮겨지지 않습니다.',
          async () => { const out = await api.adminTakeOver(t.teacher_id); return `전시실 ${out.rooms}개, 학급 ${out.classes}개를 넘겨받았습니다.`; },
          `${who}의 전시실과 학급을 모두 내 계정으로 옮길까요?\n지워지는 것은 없고, 담당만 나로 바뀝니다.`),
        admin ? '' : item('승인 취소', 'danger', '전시실을 만들거나 고칠 수 없게 됩니다. 계정과 전시실은 남습니다.', async () => { await api.setApproved(t.teacher_id, false); return `${who}의 승인을 취소했습니다.`; }),
        item('계정 지우기', 'danger', '교사 목록에서 없앱니다. 전시실이나 학급이 남아 있으면 지워지지 않으니, 먼저 삭제하거나 넘겨받아 주세요.',
          async () => { await api.adminRemoveTeacher(t.teacher_id); return `${who} 계정을 지웠습니다.`; },
          `${who} 계정을 지울까요?\n이 계정으로는 더 이상 로그인할 수 없고 되돌릴 수 없습니다. (같은 구글 계정으로 다시 가입 신청은 할 수 있습니다)`),
        (() => { const row = el('div', 'row end'); row.append(button('닫기', 'light', () => close(null))); return row; })());
    });
  }

  // 사유를 적고 비공개 처리 (교사가 공개로 바꿔도 풀리지 않음)
  function block(r) {
    return dialog((panel, close) => {
      const reason = input('textarea', '', { rows: 3, maxLength: 300, placeholder: '담당 교사에게 보이는 사유' }), row = el('div', 'row end');
      row.append(button('취소', 'light', () => close(null)), button('비공개 처리', 'danger', (b) => run(b, async () => { await api.setBlocked(r.id, true, reason.value.trim()); close(true); await refresh(); })));
      panel.append(el('h2', null, `'${r.title}' 비공개 처리`), el('p', 'muted', '관람자가 들어올 수 없게 됩니다. 담당 교사는 전시실을 볼 수 있지만 스스로 풀 수 없습니다.'), reason, row);
    });
  }
  return { refresh };
}
