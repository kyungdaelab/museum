// 작품 등록: 여러 파일 한꺼번에 올리기(끌어다 놓기), CSV 로 정보 일괄 입력, 평면도에서 자리 배치, 입체 작품 크기 · 방향 보정
import { $, el, button, field, input, run, message, dialog, confirmBox, show, mb, TYPE_LABEL } from './dom.js';
import { buildPlan, layoutOf, flatCountOf } from './plan.js';
import { KIND_OF_TYPE } from './api.js';
import { ACCEPT, ACCEPT_LABEL, LIMITS, kindOf, baseName, sizeProblem, optimizeImage, modelThumb, imageToThumb, parseArtworkCsv } from './optimize.js';
import { fileUrl } from '../data/storage.js';

const KIND_LABEL = { image: '그림', model: 'GLB 모델', splat: '스플랫' };
const FRAMES = { black: '검정', white: '흰색', wood: '밝은 나무', walnut: '짙은 나무', gold: '금색' };
const numOrNull = (v) => (Number(v) > 0 ? Number(v) : undefined);

// api = 기능 모음, onBack() = 전시실 목록으로 돌아갈 때
export function createArtworksUi({ api, onBack }) {
  let room = null, artworks = [], csv = { byFile: new Map(), inOrder: [] }, selected = null, busy = false;
  const view = $('artView');
  const thumbUrl = (a) => fileUrl(room.id, a.thumbnail_path || (a.kind === 'image' ? a.file_path : ''));
  // 혼합형: 1 ~ flatCountOf(room) 번이 벽 자리 (혼합형이 아니면 null). 그 종류의 작품이 그 자리에 들어갈 수 있는가
  const fits = (kind, no) => { const fc = flatCountOf(room); return fc == null || (kind === 'image') === (no <= fc); };
  const freeSlots = () => { const used = new Set(artworks.map((a) => a.slot)); return Array.from({ length: room.max_artworks }, (_, i) => i + 1).filter((n) => !used.has(n)); };

  async function reload() {
    [artworks, room] = await Promise.all([api.listArtworks(room.id), api.listRooms().then((list) => list.find((r) => r.id === room.id) ?? room)]);
    if (selected && !artworks.some((a) => a.id === selected)) selected = null;
    draw();
  }

  function draw() {
    const left = room.max_artworks - artworks.length, used = Number(room.storage_used_mb), limit = Number(room.storage_limit_mb);
    view.replaceChildren();

    // 머리말: 전시실 이름, 작품 수 · 남은 자리, 용량
    const head = el('div', 'row between');
    const title = el('div'); title.append(el('h2', null, room.title), el('p', 'muted', `${TYPE_LABEL[room.type]} · 작품 ${artworks.length} / ${room.max_artworks} (남은 자리 ${left}개) · 용량 ${mb(used)} / ${mb(limit)}MB`));
    head.append(title, button('← 전시실 목록', 'light', onBack));
    view.append(head);

    // 올리기
    const drop = el('label', 'drop' + (left <= 0 ? ' off' : '')), pick = input('file', '', { multiple: true, accept: ACCEPT[room.type], hidden: true, disabled: left <= 0 });
    drop.append(pick, el('b', null, left > 0 ? '여기에 파일을 끌어다 놓거나 눌러서 고르세요' : '자리가 모두 찼습니다'),
      el('span', 'muted', left > 0 ? `${ACCEPT_LABEL[room.type]} · 여러 개를 한꺼번에 올릴 수 있어요 (남은 자리 ${left}개)` : '작품을 지우거나, 전시실 설정에서 최대 작품 수를 늘리면 더 올릴 수 있어요'));
    pick.addEventListener('change', () => { const files = [...pick.files]; pick.value = ''; upload(files); });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (left > 0 && e.dataTransfer.files.length) upload([...e.dataTransfer.files]); });
    const add = button('작품 추가', '', () => pick.click()); add.disabled = left <= 0;
    const flatCount = flatCountOf(room);
    const limits = room.type === 'flat' ? '그림은 올릴 때 자동으로 긴 변 2048px · WebP 로 줄입니다 (줄인 뒤 3MB 까지)'
      : room.type === 'mixed' ? `그림은 벽 자리(1~${flatCount}번), 입체 작품은 받침대 자리(${flatCount + 1}~${room.max_artworks}번)에 자동으로 들어갑니다 · 그림 3MB, GLB 15MB, 스플랫 30MB 까지`
      : 'GLB 15MB, 스플랫(SPZ · PLY) 30MB 까지';
    const bar = el('div', 'row'); bar.append(add, el('span', 'muted', limits));
    view.append(drop, bar, csvBox(), el('div', 'queue', ''));
    view.querySelector('.queue').id = 'uploadQueue';

    if (!artworks.length) { view.append(el('p', 'muted', '아직 작품이 없습니다.')); return; }

    // 자리 배치 평면도
    const used2 = new Map(artworks.map((a) => [a.slot, a]));
    const plan = buildPlan(layoutOf(room), {
      slot(no) {
        const a = used2.get(no), b = el('button', 'pSlot' + (a ? ' filled' : '') + (a && a.id === selected ? ' sel' : ''), String(no)); b.type = 'button';
        if (a) { const u = thumbUrl(a); if (u) b.style.backgroundImage = `url("${u}")`; b.title = `${no}번: ${a.title || '제목 없음'}`; b.draggable = true; b.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/artwork', a.id)); }
        else b.title = `${no}번 자리 (비어 있음)`;
        b.addEventListener('click', () => { if (selected && (!a || a.id !== selected)) move(selected, no); else { selected = a && a.id !== selected ? a.id : null; draw(); } });
        b.addEventListener('dragover', (e) => { e.preventDefault(); b.classList.add('over'); });
        b.addEventListener('dragleave', () => b.classList.remove('over'));
        b.addEventListener('drop', (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/artwork'); if (id) move(id, no); });
        return b;
      },
    });
    const planWrap = el('div', 'planWrap');
    planWrap.append(el('h3', null, '자리 배치'), el('p', 'muted', selected ? '옮길 자리를 누르세요. 작품이 있는 자리를 누르면 서로 바꿉니다. (선택을 풀려면 같은 작품을 다시 누르기)'
      : '작품을 누른 뒤 옮길 자리를 누르거나, 작품을 원하는 자리로 끌어다 놓으세요. 위쪽이 북쪽, 왼쪽 초록 선이 입구입니다.'), plan);
    view.append(planWrap);

    // 작품 카드
    const list = el('div', 'artList');
    for (const a of artworks) list.append(card(a));
    view.append(el('h3', null, '작품 정보'), list);
  }

  // CSV 로 제목 · 작가 · 설명 일괄 입력
  function csvBox() {
    const box = el('details', 'csv'), area = input('textarea', '', { rows: 4, placeholder: '파일, 제목, 작가, 학년/반, 재료, 설명\nsea.jpg, 노을 지는 바다, 박서연, 6학년 1반, 수채 물감, 여름 방학에 본 바다' });
    const info = el('span', 'muted'), file = input('file', '', { accept: '.csv,.txt', hidden: true });
    const read = () => { csv = parseArtworkCsv(area.value); info.textContent = csv.inOrder.length ? `${csv.inOrder.length}줄 읽음` + (csv.byFile.size ? ' (파일 이름으로 맞춤)' : ' (올리는 순서대로 맞춤)') : ''; };
    area.addEventListener('input', read);
    file.addEventListener('change', async () => { const f = file.files[0]; file.value = ''; if (f) { area.value = await f.text(); read(); } });
    const apply = button('이미 올린 작품에 적용', 'small', (b) => run(b, async () => {
      let n = 0;
      for (const a of artworks) {
        const meta = csv.byFile.get(baseName((a.file_path || '').split('/').pop()).toLowerCase()) ?? csv.byFile.get((a.title || '').toLowerCase());
        if (meta) { await api.updateArtwork(a.id, Object.fromEntries(Object.entries(meta).filter(([, v]) => v))); n++; }
      }
      message(n ? `${n}개 작품에 정보를 적용했습니다.` : '맞는 작품을 찾지 못했습니다. CSV 의 파일 칸이 올린 파일 이름(또는 작품 제목)과 같아야 합니다.'); await reload();
    }));
    const pickLabel = el('label', 'small link'); pickLabel.append('CSV 파일 선택', file);
    const row = el('div', 'row'); row.append(pickLabel, apply, info);
    box.append(el('summary', null, 'CSV 로 제목 · 작가 · 설명 한꺼번에 입력'),
      el('p', 'muted', '엑셀에서 복사해 붙여 넣거나 CSV 파일을 고르세요. 열 순서: 파일, 제목, 작가, 학년/반, 재료, 설명. 먼저 여기에 넣어 두고 파일을 올리면 파일 이름이 같은 줄의 정보가 자동으로 들어갑니다. 파일 칸을 비우면 올리는 순서대로 들어갑니다.'), area, row);
    return box;
  }

  /* ── 올리기 ── */
  async function upload(files) {
    if (busy || !files.length) return;
    busy = true; message('');
    const queue = $('uploadQueue'); queue.replaceChildren();
    const lines = files.map((f) => { const li = el('div', 'qLine'); li.append(el('span', 'qName', f.name), el('span', 'qState', '기다리는 중')); queue.append(li); return li; });
    const say = (i, text, cls = '') => { lines[i].lastChild.textContent = text; lines[i].className = 'qLine ' + cls; };
    const allowed = KIND_OF_TYPE[room.type];
    let ok = 0, usedBytes = Number(room.storage_used_mb) * 1048576;
    const free = freeSlots();
    for (const [i, original] of files.entries()) {
      try {
        const kind = kindOf(original);
        if (!kind || !allowed.includes(kind)) throw new Error(`${TYPE_LABEL[room.type]} 전시실에는 ${ACCEPT_LABEL[room.type]} 파일만 올릴 수 있어요`);
        if (!free.length) throw new Error('자리가 모두 찼어요. 작품을 지우거나 최대 작품 수를 늘려 주세요');
        const at = free.findIndex((no) => fits(kind, no));      // 혼합형: 그림은 벽 자리, 입체는 받침대 자리 중 가장 앞 번호
        if (at < 0) throw new Error(kind === 'image' ? '그림을 걸 벽 자리가 모두 찼어요. 전시실 설정에서 평면 작품 수를 늘려 주세요' : '입체 작품을 놓을 받침대 자리가 모두 찼어요. 전시실 설정에서 입체 작품 수를 늘려 주세요');
        let file = original, thumb = null, note = '';
        if (kind === 'image') { say(i, '크기 줄이는 중…'); ({ file, thumb, note } = await optimizeImage(original)); }
        const problem = sizeProblem(kind, file); if (problem) throw new Error(problem);
        if (kind === 'model') { say(i, '썸네일 찍는 중…'); thumb = await modelThumb(original); }
        const bytes = file.size + (thumb?.size ?? 0);
        if (usedBytes + bytes > Number(room.storage_limit_mb) * 1048576)
          throw new Error(`이 파일을 올리면 전시실 용량 한도(${mb(room.storage_limit_mb)}MB)를 넘어요. 지금 ${mb(usedBytes / 1048576)}MB 사용 중입니다. 쓰지 않는 작품을 지우거나 파일을 더 줄여 주세요`);
        const key = baseName(original.name).toLowerCase();
        const meta = { title: baseName(original.name), ...(csv.byFile.size ? csv.byFile.get(key) : csv.inOrder[i]) };
        if (!meta.title) meta.title = baseName(original.name);
        say(i, '올리는 중…');
        await api.addArtwork(room, free[at], kind, meta, file, thumb);
        free.splice(at, 1); usedBytes += bytes; ok++;
        say(i, '완료' + (note ? ` · ${note}` : ''), 'ok');
      } catch (e) { say(i, e.message || '올리지 못했어요', 'bad'); }
    }
    busy = false;
    const kept = [...queue.children];
    await reload();
    $('uploadQueue').replaceChildren(...kept);        // 다시 그린 뒤에도 결과 줄을 남겨 둠
    if (ok) message(`${ok}개를 올렸습니다.` + (ok < files.length ? ` ${files.length - ok}개는 올리지 못했어요. 아래 줄의 이유를 확인해 주세요.` : ''));
    else message('올리지 못했습니다. 아래 줄의 이유를 확인해 주세요.', 'error');
  }

  async function move(id, slot) {
    selected = null;
    try { await api.moveArtwork(id, slot); } catch (e) { message(e.message, 'error'); }
    await reload();
  }

  /* ── 작품 카드 ── */
  function card(a) {
    const c = el('div', 'artCard' + (a.id === selected ? ' sel' : '')), pic = el('div', 'artPic'), u = thumbUrl(a);
    c.draggable = true; c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/artwork', a.id));
    if (u) pic.style.backgroundImage = `url("${u}")`; else pic.textContent = KIND_LABEL[a.kind];
    pic.append(el('span', 'slotNo', `${a.slot}번`));
    pic.addEventListener('click', () => { selected = a.id === selected ? null : a.id; draw(); });
    pic.title = '눌러서 선택한 뒤 평면도에서 옮길 자리를 누르세요';

    const f = {
      title: input('text', a.title, { maxLength: 80, placeholder: '제목' }), artist: input('text', a.artist, { maxLength: 40, placeholder: '작가 (비우면 익명)' }),
      grade: input('text', a.grade, { maxLength: 40, placeholder: '학년/반' }), material: input('text', a.material, { maxLength: 80, placeholder: '재료' }),
      w: input('number', a.size_cm?.width ?? '', { min: 0, placeholder: '가로' }), h: input('number', a.size_cm?.height ?? '', { min: 0, placeholder: a.kind === 'image' ? '세로' : '높이' }), d: input('number', a.size_cm?.depth ?? '', { min: 0, placeholder: '깊이' }),
      description: input('textarea', a.description, { maxLength: 2000, rows: 2, placeholder: '작품 설명' }),
    };
    const size = el('div', 'row sizes'); size.append('크기(cm)', f.w, f.h); if (a.kind !== 'image') size.append(f.d);
    const form = el('div', 'artForm'); form.append(f.title, f.artist, f.grade, f.material, size, f.description);
    let frame = null;
    if (a.kind === 'image') { frame = el('select'); for (const [k, v] of Object.entries(FRAMES)) { const o = el('option', null, v); o.value = k; frame.append(o); } frame.value = a.adjust?.frameColor ?? 'black'; form.append(field('액자 색', frame, 'f inline')); }

    const acts = el('div', 'row acts');
    acts.append(button('저장', 'small', (b) => run(b, async () => {
      await api.updateArtwork(a.id, { title: f.title.value.trim(), artist: f.artist.value.trim(), grade: f.grade.value.trim(), material: f.material.value.trim(), description: f.description.value.trim(),
        size_cm: { width: numOrNull(f.w.value), height: numOrNull(f.h.value), depth: a.kind === 'image' ? undefined : numOrNull(f.d.value) },
        adjust: frame ? { ...(a.adjust ?? {}), frameColor: frame.value } : a.adjust });
      message(`'${f.title.value.trim() || '작품'}' 정보를 저장했습니다.`); await reload();
    })));
    if (a.kind !== 'image') acts.append(button('크기 · 방향 보정', 'small', () => adjust(a)));
    if (a.kind === 'splat') {
      const pickThumb = input('file', '', { accept: 'image/*', hidden: true }), lab = el('label', 'small link'); lab.append(a.thumbnail_path ? '대신 보여 줄 사진 바꾸기' : '대신 보여 줄 사진 올리기', pickThumb);
      pickThumb.addEventListener('change', () => run(null, async () => { const file = pickThumb.files[0]; if (!file) return; await api.setThumbnail(a, await imageToThumb(file)); message('사진을 올렸습니다. 스플랫이 켜지기 전에는 이 사진이 받침대 위에 보입니다.'); await reload(); }));
      acts.append(lab);
    }
    acts.append(el('span', 'muted', `${KIND_LABEL[a.kind]} · ${mb(a.file_size / 1048576)}MB`), button('삭제', 'small danger', async (b) => {
      if (!await confirmBox(`${a.slot}번 '${a.title || '제목 없음'}' 작품을 삭제할까요? 올린 파일도 함께 지워집니다.`, '삭제')) return;
      await run(b, async () => { await api.removeArtwork(a.id); await reload(); });
    }));
    const right = el('div', 'artBody'); right.append(form, acts);
    c.append(pic, right);
    return c;
  }

  /* ── 입체 작품: 받침대 위 크기 · 방향 보정 ── */
  function adjust(a) {
    return dialog(async (panel, close) => {
      const rot = (a.adjust?.rotation ?? [0, 0, 0]).map((v) => Number(v) || 0), err = el('p', 'wizErr');
      const height = input('number', a.size_cm?.height ?? '', { min: 1, max: 300, placeholder: '예: 45' });
      const sliders = ['앞뒤로 눕히기 (X)', '좌우로 돌리기 (Y)', '옆으로 기울이기 (Z)'].map((label, i) => {
        const s = input('range', rot[i], { min: -180, max: 180, step: 5 }), out = el('span', 'num', rot[i] + '°'), row = el('label', 'slider');
        s.addEventListener('input', () => { rot[i] = +s.value; out.textContent = rot[i] + '°'; update?.(); });
        row.append(label, s, out); return row;
      });
      const quick = el('div', 'row'); quick.append('빠른 보정:',
        button('누운 것 세우기', 'small', () => set([-90, 0, 0])), button('반대로 세우기', 'small', () => set([90, 0, 0])), button('뒤집힌 것 바로', 'small', () => set([180, 0, 0])), button('처음으로', 'small', () => set([0, 0, 0])));
      const set = (v) => { v.forEach((x, i) => { rot[i] = x; sliders[i].querySelector('input').value = x; sliders[i].lastChild.textContent = x + '°'; }); update?.(); };
      let update = null, stop = () => {};
      const stage = el('div', 'adjStage');
      panel.append(el('h2', null, `'${a.title || '작품'}' 크기 · 방향 보정`), stage, quick, ...sliders, field('실제 높이 (cm)', height, 'f inline'));
      height.addEventListener('input', () => update?.());

      // 스플랫: 크롭(작품만 남기기) 범위
      let cropType = null, cropFields = {};
      if (a.kind === 'splat') {
        const crop = a.adjust?.crop ?? {}, box = el('div', 'cropBox');
        cropType = el('select'); for (const [k, v] of [['', '자르지 않음'], ['cylinder', '원형으로 자르기'], ['box', '상자로 자르기']]) { const o = el('option', null, v); o.value = k; cropType.append(o); }
        cropType.value = crop.type ?? '';
        const n = (v, ph) => input('number', v ?? '', { step: 'any', placeholder: ph });
        cropFields = { cx: n(crop.center?.[0], '중심 x'), cz: n(crop.center?.[1], '중심 z'), r: n(crop.radius, '반지름'), y0: n(crop.yMin, '아래 y'), y1: n(crop.yMax, '위 y'),
          x0: n(crop.min?.[0], '최소 x'), b0: n(crop.min?.[1], '최소 y'), z0: n(crop.min?.[2], '최소 z'), x1: n(crop.max?.[0], '최대 x'), b1: n(crop.max?.[1], '최대 y'), z1: n(crop.max?.[2], '최대 z') };
        const cyl = el('div', 'row'), bx = el('div', 'row');
        cyl.append(cropFields.cx, cropFields.cz, cropFields.r, cropFields.y0, cropFields.y1); bx.append(cropFields.x0, cropFields.b0, cropFields.z0, cropFields.x1, cropFields.b1, cropFields.z1);
        const sync = () => { show(cyl, cropType.value === 'cylinder'); show(bx, cropType.value === 'box'); }; cropType.addEventListener('change', sync); sync();
        box.append(field('배경 잘라 내기', cropType, 'f inline'), cyl, bx, el('p', 'muted', '스캔에 함께 찍힌 바닥 · 주변 물건을 잘라 냅니다. 좌표는 방향을 보정한 뒤의 스캔 파일 단위입니다. 전시실에 들어가 작품에 가까이 가면 F12 콘솔에 "전체 범위"가 나오니 그 숫자를 보고 좁혀 가세요.'));
        panel.append(box);
        stage.append(el('p', 'muted', '스플랫은 여기서 미리보기가 되지 않습니다. 저장한 뒤 전시실에 들어가 확인해 주세요.'));
      }
      const foot = el('div', 'row end');
      foot.append(button('취소', 'light', () => { stop(); close(null); }), button('저장', '', async (b) => {
        b.disabled = true; err.textContent = '';
        try {
          const adj = { ...(a.adjust ?? {}), rotation: [...rot] };
          if (a.kind === 'splat') {
            const v = (k) => (cropFields[k].value === '' ? undefined : Number(cropFields[k].value));
            if (cropType.value === 'cylinder') adj.crop = { type: 'cylinder', center: [v('cx') ?? 0, v('cz') ?? 0], radius: v('r'), yMin: v('y0'), yMax: v('y1') };
            else if (cropType.value === 'box') adj.crop = { type: 'box', min: [v('x0') ?? 0, v('b0') ?? 0, v('z0') ?? 0], max: [v('x1') ?? 0, v('b1') ?? 0, v('z1') ?? 0] };
            else delete adj.crop;
          }
          await api.updateArtwork(a.id, { adjust: adj, size_cm: { ...(a.size_cm ?? {}), height: numOrNull(height.value) } });
          stop(); close(true); message('크기 · 방향을 저장했습니다. 전시실에 들어가면 반영됩니다.'); await reload();
        } catch (e) { err.textContent = e.message; b.disabled = false; }
      }));
      panel.append(err, foot);
      if (a.kind !== 'model') return;

      // GLB 미리보기: 전시실과 같은 방법으로 받침대 위에 올려 본다 (옆의 회색 기둥 = 키 150cm 캐릭터)
      try {
        const THREE = await import('three');
        const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }, { OrbitControls }] = await Promise.all([
          import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/DRACOLoader.js'), import('three/addons/libs/meshopt_decoder.module.js'), import('three/addons/controls/OrbitControls.js')]);
        const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        stage.append(renderer.domElement);
        const scene = new THREE.Scene(); scene.background = new THREE.Color(0xe9e6df);
        const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50); camera.position.set(1.8, 1.6, 3.2);
        const orbit = new OrbitControls(camera, renderer.domElement); orbit.target.set(0, 1, 0); orbit.enablePan = false; orbit.maxDistance = 8;
        scene.add(new THREE.HemisphereLight(0xffffff, 0xcbbfae, 2.2)); const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-2, 4, 3); scene.add(sun);
        const ground = new THREE.Mesh(new THREE.CircleGeometry(2.4, 40), new THREE.MeshLambertMaterial({ color: 0xd9b98a })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
        const person = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.5, 0.28), new THREE.MeshLambertMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.55 })); person.position.set(-1.1, 0.75, 0); scene.add(person);
        const pedestal = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff })); scene.add(pedestal);
        const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/gltf/')).setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.loadAsync(fileUrl(room.id, a.file_path));
        const pivot = new THREE.Group(), holder = new THREE.Group(); pivot.add(gltf.scene); holder.add(pivot); scene.add(holder);
        update = () => {            // 전시실(src/artworks/model.js)과 같은 계산
          pivot.scale.setScalar(1); pivot.position.set(0, 0, 0);
          pivot.rotation.set(...rot.map((v) => THREE.MathUtils.degToRad(v)));
          holder.position.set(0, 0, 0); holder.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(pivot, true), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
          const scale = (numOrNull(height.value) ? height.value / 100 : 0.5 * size.y / Math.max(size.x, size.y, size.z)) / (size.y || 1);
          const w = size.x * scale, h = size.y * scale, d = size.z * scale;
          const side = THREE.MathUtils.clamp(Math.max(w, d) + 0.24, 0.4, 1.3), pedH = THREE.MathUtils.clamp(1.25 - h / 2, 0.25, 1.1);
          pedestal.scale.set(side, pedH, side); pedestal.position.set(0, pedH / 2, 0);
          pivot.scale.setScalar(scale); pivot.position.set(-c.x * scale, -box.min.y * scale, -c.z * scale);
          holder.position.set(0, pedH, 0);
        };
        update();
        let alive = true;
        const resize = () => { const w = stage.clientWidth || 420, h = Math.min(360, w * 0.75); renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; camera.aspect = w / h; camera.updateProjectionMatrix(); };
        resize();
        const loop = () => {
          if (alive && !renderer.domElement.isConnected) stop();      // 창 바깥을 눌러 닫은 경우에도 정리
          if (!alive) return; orbit.update(); renderer.render(scene, camera); requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
        stop = () => { alive = false; renderer.dispose(); renderer.forceContextLoss(); };
      } catch (e) { stage.append(el('p', 'muted', '미리보기를 불러오지 못했습니다. 숫자만 고쳐 저장할 수 있습니다. (' + e.message + ')')); }
    }, { wide: true });
  }

  return {
    async open(r) { room = r; selected = null; csv = { byFile: new Map(), inOrder: [] }; view.replaceChildren(el('p', 'muted', '불러오는 중…')); await reload(); },
    get room() { return room; },
  };
}
export { LIMITS };
