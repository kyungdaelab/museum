// 작품 관리자: 한 전시실의 작품 목록을 받아 자리 번호(slot)에 맞춰 전시하고, 전시실에서 나갈 때 정리한다.
//
// ▸ 새 작품 종류(type) 추가: 만드는 함수를 파일로 만들고 BUILDERS 에 등록한 뒤,
//   src/room/templates.js 의 ROOM_TYPES[유형].accepts 에 그 type 을 넣으면 됩니다.
//
// build(art, slot, ctx) → 작품 정보(entry)에 합쳐질 값
//   pick   : 클릭 판정에 쓸 물체 목록
//   near   : 이름표가 뜨는 기준 거리에 더해 줄 반지름 (입체 작품은 받침대만큼 더 멀리서도 뜸)
//   update : (선택) 매 프레임 호출 — 지연 로딩 등에 사용
import * as THREE from 'three';
import { buildImage } from './image.js';
import { buildModel } from './model.js';
import { buildSplat } from './splat.js';

const BUILDERS = { image: buildImage, model: buildModel, splat: buildSplat };
const TYPE_LABEL = { image: '평면 작품(image)', model: '입체 작품(model)', splat: '스플랫 작품(splat)' };

// 가우시안 스플랫: 무거우므로 가까운 것만 보여 주고 나머지는 썸네일로 대신함
const SPLAT_MAX = 2;                 // 동시에 보여 주는 스플랫 최대 개수
const SPLAT_SHOW = 9;                // 이 거리(m) 안으로 오면 스플랫 표시
const SPLAT_KEEP = 11;               // 이 거리(m) 밖으로 나가면 메모리에서 해제 (경계에서 깜빡이지 않게 SHOW 보다 크게)

/* room      : buildRoom() 결과
   list      : 작품 목록 [{ id, type, title, …, slot }]
   opts      : { scene, renderer, resolveUrl(path), onWarn(message) } */
export async function loadArtworks(room, list, { scene, renderer, resolveUrl, onWarn }) {
  const warnings = [], artworks = [];
  let alive = true;
  const ctx = {
    scene, renderer, root: room.root, wallH: room.wallH, camBlockers: room.camBlockers,
    addCircle: (c) => { room.circles.push(c); return c; },
    url: resolveUrl,
    alive: () => alive,                // 전시실에서 나간 뒤 도착한 로딩 결과를 버리기 위한 확인
    warn: (msg, art) => { if (!alive) return; const m = `[작품 ${art?.id ?? '?'}] ${msg}`; warnings.push(m); console.warn(m); onWarn?.(m, warnings); },
  };

  if (!Array.isArray(list)) { ctx.warn('작품 목록이 올바르지 않습니다', { id: '목록' }); list = []; }
  if (list.length > room.layout.count)
    ctx.warn(`작품이 ${list.length}개인데 이 전시실의 최대 작품 수는 ${room.layout.count}개입니다. 자리 번호가 넘치는 작품은 전시되지 않습니다`, { id: '목록' });

  const used = new Set();
  await Promise.all(list.map(async (art, i) => {
    if (!art || typeof art !== 'object') return ctx.warn(`${i + 1}번째 항목이 올바르지 않습니다`, null);
    const slot = room.slots[art.slot], build = BUILDERS[art.type];
    if (!build) return ctx.warn(`지원하지 않는 종류(type)입니다: ${art.type}`, art);
    if (!room.type.accepts.includes(art.type)) return ctx.warn(`${room.type.label} 전시실에는 ${TYPE_LABEL[art.type]}을 전시할 수 없습니다`, art);
    if (!slot) return ctx.warn(`없는 자리 번호입니다: ${art.slot} (이 전시실은 1~${room.layout.count}번)`, art);
    if (used.has(art.slot)) return ctx.warn(`${art.slot}번 자리에 이미 다른 작품이 있습니다`, art);
    used.add(art.slot);
    try {
      const built = await build(art, slot, ctx);
      if (!built || !alive) return;
      const entry = Object.assign(built, { data: art, kind: art.type, x: slot.x, z: slot.z });
      for (const o of entry.pick) o.userData.artwork = entry;
      artworks.push(entry);
    } catch (e) { ctx.warn(e.message, art); }
  }));
  const splats = () => artworks.filter((a) => a.kind === 'splat');
  const pickRay = new THREE.Raycaster();

  return {
    artworks, warnings,
    // 매 프레임 호출. pos = 관람객 위치, pinned = 감상 모드로 보고 있는 작품(있으면 해제하지 않음)
    update(pos, pinned = null) {
      if (!alive) return;
      for (const a of artworks) a.update?.(pos);
      // 스플랫: 가까운 순서로 최대 SPLAT_MAX 개만 켜고 나머지는 해제
      const list = splats().filter((a) => a.status !== 'error');
      for (const a of list) a._d = a === pinned ? -1 : Math.hypot(pos.x - a.x, pos.z - a.z);
      list.sort((a, b) => (a._d - (a.status === 'idle' ? 0 : 1)) - (b._d - (b.status === 'idle' ? 0 : 1)));     // 이미 켜진 것을 1m 만큼 우대
      let on = 0;
      for (const a of list) {
        const keep = on < SPLAT_MAX && a._d <= (a.status === 'idle' ? SPLAT_SHOW : SPLAT_KEEP);
        if (keep) { on++; if (a.status === 'idle') a.activate(); }
        else if (a.status !== 'idle') a.release();
      }
    },
    // maxDist 안에 있는 가장 가까운 작품. 액자는 '앞쪽'에서만 잡히고(벽 뒤편 제외), 입체 작품은 받침대 둘레 어디서나 잡힘
    nearest(pos, maxDist) {
      let best = null, bestD = Infinity;
      for (const a of artworks) {
        const dx = pos.x - a.x, dz = pos.z - a.z;
        if (a.kind === 'image' && dx * a.nx + dz * a.nz < 0.05) continue;
        const d = Math.hypot(dx, dz) - a.near;
        if (d <= maxDist && d < bestD) { best = a; bestD = d; }
      }
      return best;
    },
    // 화면의 한 점(ndc)에서 클릭된 작품. 벽에 가려진 작품은 제외
    pick(ndc, camera, far) {
      pickRay.setFromCamera(ndc, camera); pickRay.far = far;
      const hit = pickRay.intersectObjects([...artworks.flatMap((a) => a.pick), ...room.camBlockers], true)[0];
      for (let o = hit?.object; o; o = o.parent) if (o.userData.artwork) return o.userData.artwork;
      return null;
    },
    // 전시실에서 나갈 때: 진행 중인 로딩을 무효로 만들고 스플랫을 해제. (나머지 3D 자원은 room.dispose() 가 해제)
    dispose() {
      alive = false;
      for (const a of splats()) a.release();
      artworks.length = 0;
    },
  };
}
