// 내 전시실: 전시실 카드 목록, '새 전시실 만들기' 마법사, 공유(QR), 공동 교사 초대
import { $, el, button, field, input, run, message, dialog, confirmBox, mb, VISIBILITY, TYPE_LABEL } from './dom.js';
import { buildPlan, layoutOf } from './plan.js';
import { WALLS, FLOORS, BRIGHTNESS, DEFAULT_THEME } from '../room/themes.js';
import { showShare } from '../ui/dialogs.js';

const siteUrl = location.origin + location.pathname.replace(/teacher\.html$/, '');
const roomUrl = (room) => `${siteUrl}?room=${encodeURIComponent(room.id)}`;
const select = (table, value) => { const s = el('select'); for (const [k, v] of Object.entries(table)) { const o = el('option', null, v.label ?? v); o.value = k; s.append(o); } s.value = value; return s; };

// api = 기능 모음, onManage(room) = '작품 관리'를 눌렀을 때
export function createRoomsUi({ api, onManage }) {
  let rooms = [], settings = { max_rooms_per_teacher: 3 };

  async function refresh() {
    [rooms, settings] = await Promise.all([api.listRooms(), api.getSettings()]);
    const mine = rooms.filter((r) => r.is_owner).length, box = $('roomCards');
    $('roomQuota').textContent = `내 전시실 ${mine}개 / 최대 ${settings.max_rooms_per_teacher}개`;
    $('newRoomBtn').disabled = mine >= settings.max_rooms_per_teacher;
    $('newRoomBtn').title = $('newRoomBtn').disabled ? '만들 수 있는 전시실 수를 모두 썼습니다' : '';
    box.replaceChildren();
    if (!rooms.length) box.append(el('p', 'muted', '아직 전시실이 없습니다. "새 전시실 만들기"를 눌러 시작해 보세요.'));
    for (const r of rooms) box.append(card(r));
    return rooms;
  }

  // 전시실 카드: 작품 수 · 용량 · 공개 상태와 버튼들
  function card(r) {
    const c = el('div', 'roomCard'), top = el('div', 'row');
    top.append(el('span', 'tag ' + r.type, TYPE_LABEL[r.type]), el('span', 'tag vis ' + r.visibility, VISIBILITY[r.visibility] + (r.has_entry_code ? ' · 입장 코드' : '')));
    if (!r.is_owner) top.append(el('span', 'tag', '공동 담당'));
    c.append(top, el('b', null, r.title));
    if (r.blocked) c.append(el('p', 'warnBox', `관리자가 이 전시실을 비공개 처리했습니다. 사유: ${r.blocked_reason || '(없음)'}`));
    const used = Number(r.storage_used_mb), limit = Number(r.storage_limit_mb);
    c.append(meter('작품', r.artwork_count, r.max_artworks, `${r.artwork_count} / ${r.max_artworks}`),
      meter('용량', used, limit, `${mb(used)} / ${mb(limit)}MB`));
    const acts = el('div', 'row acts');
    acts.append(button('작품 관리', '', () => onManage(r)),
      button('입장하기', 'light', () => window.open(roomUrl(r), '_blank')),
      button('QR코드 받기', 'light', () => showShare(r.title, roomUrl(r))),
      button('설정', 'light', () => wizard(r)));
    if (r.is_owner) acts.append(button('공동 교사 초대', 'light', () => invite(r)), button('삭제', 'small danger', (b) => remove(r, b)));
    if (r.visibility === 'private') c.append(el('p', 'muted', '비공개 상태라 관람자는 들어올 수 없습니다. 설정에서 공개 범위를 바꾸면 주소 · QR 로 들어올 수 있습니다.'));
    c.append(acts);
    return c;
  }
  function meter(label, value, max, text) {
    const w = el('div', 'meter'), bar = el('div', 'bar'), fill = el('i');
    const ratio = max > 0 ? Math.min(1, value / max) : 0;
    fill.style.width = ratio * 100 + '%'; if (ratio >= 0.9) fill.className = 'full';
    bar.append(fill); w.append(el('span', null, label), bar, el('span', 'num', text));
    return w;
  }
  async function remove(r, btn) {
    if (!await confirmBox(`'${r.title}' 전시실을 삭제할까요?\n작품 ${r.artwork_count}개와 올린 파일이 모두 지워지고 되돌릴 수 없습니다.`, '삭제')) return;
    await run(btn, async () => { await api.deleteRoom(r.id); message(`'${r.title}' 전시실을 삭제했습니다.`); await refresh(); });
  }

  /* ── 만들기 마법사 (기존 전시실을 넘기면 설정 수정) ── */
  function wizard(existing = null) {
    const editing = !!existing;
    const d = {
      type: existing?.type ?? 'flat', title: existing?.title ?? '', description: existing?.description ?? '',
      starts_on: existing?.starts_on ?? '', ends_on: existing?.ends_on ?? '', max_artworks: existing?.max_artworks ?? 10,
      theme: { ...DEFAULT_THEME, arrangement: 'grid', ...(existing?.theme ?? {}) },
      visibility: existing?.visibility ?? 'link', code: '', guest_allowed: existing?.guest_allowed ?? true, guest_avatar_mode: existing?.guest_avatar_mode ?? 'base', classes: [],
    };
    const STEPS = ['유형', '제목 · 기간', '작품 수', '테마', '공개 범위'];
    let step = editing ? 1 : 0, myClasses = [];

    return dialog(async (panel, close) => {
      if (editing) { [d.code, d.classes] = await Promise.all([api.getEntryCode(existing.id).catch(() => ''), api.listRoomClasses(existing.id).catch(() => [])]); }
      myClasses = await api.listClasses().catch(() => []);
      const head = el('div', 'steps'), body = el('div', 'wizBody'), err = el('p', 'wizErr'), nav = el('div', 'row end');
      const prev = button('이전', 'light', () => go(step - 1)), next = button('다음', '', () => go(step + 1));
      nav.append(button('취소', 'light', () => close(null)), prev, next);
      panel.append(el('h2', null, editing ? `'${existing.title}' 설정` : '새 전시실 만들기'), head, body, err, nav);

      const plan = () => { const p = buildPlan(layoutOf({ type: d.type, max_artworks: d.max_artworks, theme: d.theme })); p.classList.add('preview'); return p; };
      const check = () => {            // 지금 단계에서 넘어가도 되는지
        if (step === 1 && !d.title.trim()) return '전시 제목을 적어 주세요';
        if (step === 1 && d.starts_on && d.ends_on && d.ends_on < d.starts_on) return '끝나는 날이 시작하는 날보다 빠릅니다';
        if (step === 4 && d.code && (d.code.length < 4 || d.code.length > 20)) return '입장 코드는 4~20자로 적어 주세요';
        if (step === 4 && d.visibility === 'class' && !d.classes.length) return '학급 전용 전시실에는 들어올 학급을 하나 이상 골라 주세요. (학급은 "학급 · 학생" 탭에서 만듭니다)';
        return '';
      };
      async function go(to) {
        if (to > step) { const problem = check(); err.textContent = problem; if (problem) return; }
        if (to >= STEPS.length) return finish();
        step = Math.max(editing ? 1 : 0, to); err.textContent = ''; draw();
      }
      async function finish() {
        next.disabled = true; err.textContent = '';
        try {
          const payload = { title: d.title.trim(), description: d.description.trim(), type: d.type, max_artworks: d.max_artworks, theme: d.theme,
            visibility: d.visibility, starts_on: d.starts_on || null, ends_on: d.ends_on || null, guest_allowed: d.guest_allowed, guest_avatar_mode: d.guest_avatar_mode };
          const room = editing ? await api.updateRoom(existing.id, payload) : await api.createRoom(payload);
          await api.setEntryCode(room.id, d.visibility === 'private' || d.visibility === 'class' ? '' : d.code.trim());
          await api.setRoomClasses(room.id, d.visibility === 'class' ? d.classes : []);
          close(room);
          message(editing ? '전시실 설정을 저장했습니다.' : `'${room.title}' 전시실을 만들었습니다. 이제 작품을 올려 보세요.`);
          await refresh();
          if (!editing) onManage((await api.listRooms()).find((r) => r.id === room.id) ?? room);
        } catch (e) { err.textContent = e.message; next.disabled = false; }
      }

      function draw() {
        head.replaceChildren(...STEPS.map((s, i) => el('span', i === step ? 'on' : i < step ? 'done' : '', `${i + 1} ${s}`)));
        prev.disabled = step === (editing ? 1 : 0);
        next.textContent = step === STEPS.length - 1 ? (editing ? '저장' : '전시실 만들기') : '다음';
        body.replaceChildren();
        if (step === 0) {            // ① 유형: 예시 평면도와 함께
          const grid = el('div', 'typeGrid');
          for (const [type, text] of [['flat', '그림 · 사진처럼 벽에 거는 작품. 벽을 따라 한 바퀴 도는 갤러리'], ['sculpture', 'GLB 모델 · 3D 스캔(스플랫)처럼 받침대에 올리는 작품. 넓은 홀']]) {
            const b = el('button', 'typeCard' + (d.type === type ? ' sel' : '')); b.type = 'button';
            const example = buildPlan(layoutOf({ type, max_artworks: 10, theme: {} })); example.classList.add('preview');
            b.append(el('b', null, TYPE_LABEL[type]), example, el('span', 'muted', text));
            b.addEventListener('click', () => { d.type = type; draw(); });
            grid.append(b);
          }
          body.append(grid, el('p', 'muted', '유형은 나중에 바꿀 수 없습니다. (작품이 하나도 없을 때만 바꿀 수 있어요)'));
        } else if (step === 1) {     // ② 제목 · 설명 · 기간
          const title = input('text', d.title, { maxLength: 80, placeholder: '예: 5학년 2반 가을 그림 전시회' }), desc = input('textarea', d.description, { maxLength: 1000, rows: 3, placeholder: '입구 안내판에 들어갈 전시 소개 (선택)' });
          const from = input('date', d.starts_on), to = input('date', d.ends_on);
          title.addEventListener('input', () => { d.title = title.value; }); desc.addEventListener('input', () => { d.description = desc.value; });
          from.addEventListener('input', () => { d.starts_on = from.value; }); to.addEventListener('input', () => { d.ends_on = to.value; });
          const dates = el('div', 'row'); dates.append(field('시작하는 날', from), field('끝나는 날', to));
          body.append(field('전시 제목', title, 'f wide'), field('설명', desc, 'f wide'), dates, el('p', 'muted', '기간은 입구 안내판에 표시됩니다. 기간이 지나도 자동으로 닫히지는 않습니다.'));
        } else if (step === 2) {     // ③ 최대 작품 수
          const range = input('range', d.max_artworks, { min: 1, max: 30, step: 1 }), out = el('b', 'big'), info = el('p', 'muted'), holder = el('div');
          const update = () => {
            d.max_artworks = +range.value; out.textContent = `${d.max_artworks}점`;
            const l = layoutOf({ type: d.type, max_artworks: d.max_artworks, theme: d.theme });
            info.textContent = `공간 크기 ${l.width.toFixed(1)} × ${l.depth.toFixed(1)}m` + (d.type === 'flat' ? ` · 방 ${Math.ceil(d.max_artworks / 10)}개` : '') + ' · 숫자는 자리 번호';
            holder.replaceChildren(plan());
          };
          range.addEventListener('input', update); update();
          const row = el('div', 'row'); row.append(range, out);
          body.append(el('p', null, '전시할 작품 수에 맞춰 공간이 자동으로 만들어집니다. 나중에 늘리거나 줄일 수 있어요.'), row, info, holder);
        } else if (step === 3) {     // ④ 테마
          const row = el('div', 'row'), holder = el('div');
          const bind = (label, table, key) => { const s = select(table, d.theme[key]); s.addEventListener('change', () => { d.theme[key] = s.value; holder.replaceChildren(plan()); }); row.append(field(label, s)); };
          bind('벽 색', WALLS, 'wall'); bind('바닥', FLOORS, 'floor'); bind('조명 밝기', BRIGHTNESS, 'brightness');
          if (d.type === 'sculpture') bind('받침대 배치', { grid: '격자', circle: '원형' }, 'arrangement');
          holder.append(plan());
          body.append(row, el('p', 'muted', '색과 밝기는 전시실에 들어가서 확인할 수 있고, 언제든 바꿀 수 있습니다.'), holder);
        } else {                      // ⑤ 공개 범위 · 입장 코드
          const opts = el('div', 'visGrid'), extra = el('div');
          const TEXT = { public: '전시실 목록에 보이고 누구나 들어옵니다', link: '목록에는 안 보이고, 주소 · QR 을 가진 사람만 들어옵니다', class: '고른 학급의 학생(로그인)과 교사만 들어옵니다', private: '준비 중. 담당 교사만 볼 수 있습니다' };
          for (const v of ['public', 'link', 'class', 'private']) {
            const b = el('button', 'visCard' + (d.visibility === v ? ' sel' : '')); b.type = 'button';
            b.append(el('b', null, VISIBILITY[v]), el('span', 'muted', TEXT[v]));
            b.addEventListener('click', () => { d.visibility = v; draw(); });
            opts.append(b);
          }
          if (d.visibility === 'public' || d.visibility === 'link') {
            const code = input('text', d.code, { maxLength: 20, placeholder: '비워 두면 코드 없이 입장' }), guest = input('checkbox'), mode = select({ base: '기본 모형 + 색만 (권장)', full: '꾸민 그대로' }, d.guest_avatar_mode);
            guest.checked = d.guest_allowed;
            code.addEventListener('input', () => { d.code = code.value; }); guest.addEventListener('change', () => { d.guest_allowed = guest.checked; }); mode.addEventListener('change', () => { d.guest_avatar_mode = mode.value; });
            const g = el('label', 'check'); g.append(guest, '로그인하지 않은 관람자(게스트)도 들어올 수 있음');
            extra.append(field('입장 코드 (선택, 4~20자)', code), g, field('게스트 캐릭터가 다른 사람에게 보이는 모습', mode));
          } else if (d.visibility === 'class') {
            extra.append(el('p', null, '들어올 수 있는 학급'));
            if (!myClasses.length) extra.append(el('p', 'muted', '아직 학급이 없습니다. "학급 · 학생" 탭에서 먼저 만들어 주세요.'));
            for (const c of myClasses) {
              const box = input('checkbox'); box.checked = d.classes.includes(c.id);
              box.addEventListener('change', () => { d.classes = box.checked ? [...d.classes, c.id] : d.classes.filter((x) => x !== c.id); });
              const l = el('label', 'check'); l.append(box, `${c.school} ${c.name} (${c.code})`); extra.append(l);
            }
          }
          body.append(opts, extra);
        }
      }
      draw();
    }, { wide: true });
  }

  /* ── 공동 교사 초대 ── */
  function invite(room) {
    return dialog(async (panel, close) => {
      const list = el('div'), err = el('p', 'wizErr');
      panel.append(el('h2', null, `'${room.title}' 공동 교사`), el('p', 'muted', '공동 교사는 이 전시실의 설정과 작품을 고칠 수 있습니다. 전시실 삭제와 다른 교사 초대는 할 수 없습니다.'), list, err);
      const foot = el('div', 'row end'); foot.append(button('닫기', 'light', () => close(null))); panel.append(foot);
      const draw = async () => {
        const [editors, all] = await Promise.all([api.listEditors(room.id), api.teacherDirectory()]);
        const ids = new Set(editors.map((e) => e.id));
        list.replaceChildren();
        if (!all.length) list.append(el('p', 'muted', '초대할 수 있는 승인된 교사가 아직 없습니다.'));
        for (const t of all) {
          const row = el('div', 'row between'), on = ids.has(t.teacher_id ?? t.id), tid = t.teacher_id ?? t.id;
          row.append(el('span', null, `${t.name}${t.school ? ' · ' + t.school : ''}`), button(on ? '초대 취소' : '초대', on ? 'small danger' : 'small', async (b) => {
            b.disabled = true; err.textContent = '';
            try { if (on) await api.removeEditor(room.id, tid); else await api.addEditor(room.id, tid); await draw(); } catch (e) { err.textContent = e.message; b.disabled = false; }
          }));
          list.append(row);
        }
      };
      await draw().catch((e) => { err.textContent = e.message; });
    });
  }

  $('newRoomBtn').addEventListener('click', () => wizard());
  return { refresh, get rooms() { return rooms; } };
}
