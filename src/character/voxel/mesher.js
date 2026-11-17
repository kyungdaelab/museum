// 복셀 → 메시 합치기 (greedy meshing)
// 복셀을 하나씩 그리지 않고, 겉으로 드러난 면만 골라 같은 색의 이웃한 면을 큰 사각형으로 합친다. 색은 꼭짓점 색(vertex color).
import * as THREE from 'three';

/* model  : VoxelModel
   part   : 부위 번호. 그 부위의 복셀만 메시로 만든다 (0 = 전체를 하나로)
            다른 부위와 맞닿은 면은 남겨 둔다 → 팔·다리가 움직여도 속이 비어 보이지 않음
   origin : 메시의 원점이 될 격자 좌표 [x, y, z] (부위의 관절 위치)
   scale  : 한 칸의 크기(m)
   colors : 팔레트 번호 → THREE.Color */
export function buildGeometry(model, { part = 0, origin = [0, 0, 0], scale = 1, colors }) {
  const dims = model.size, [sx, , sz] = dims;
  const pos = [], nor = [], col = [], idx = [];
  const at = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) return 0;
    const i = x + sx * (z + sz * y), c = model.ci[i];
    return c && (!part || model.part[i] === part) ? c : 0;
  };

  for (let d = 0; d < 3; d++) {                 // d = 면이 향하는 축
    const u = (d + 1) % 3, v = (d + 2) % 3, x = [0, 0, 0], q = [0, 0, 0];
    const mask = new Int16Array(dims[u] * dims[v]);
    q[d] = 1;
    for (x[d] = -1; x[d] < dims[d];) {
      // 1) 이 단면에서 드러난 면 찾기: +색번호 = 앞쪽(+축)을 보는 면, -색번호 = 뒤쪽을 보는 면
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; x[v]++) for (x[u] = 0; x[u] < dims[u]; x[u]++) {
        const a = at(x[0], x[1], x[2]), b = at(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
        mask[n++] = a && b ? 0 : a ? a : -b;
      }
      x[d]++;
      // 2) 같은 색의 이웃한 면을 가로 → 세로 순으로 넓혀 큰 사각형으로 합치기
      n = 0;
      for (let j = 0; j < dims[v]; j++) for (let i = 0; i < dims[u];) {
        const c = mask[n];
        if (!c) { i++; n++; continue; }
        let w = 1; while (i + w < dims[u] && mask[n + w] === c) w++;
        let h = 1;
        grow: for (; j + h < dims[v]; h++) for (let k = 0; k < w; k++) if (mask[n + k + h * dims[u]] !== c) break grow;
        x[u] = i; x[v] = j;
        const du = [0, 0, 0], dv = [0, 0, 0]; du[u] = w; dv[v] = h;
        const base = pos.length / 3, color = colors[Math.abs(c)], s = c > 0 ? 1 : -1;
        for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          for (let t = 0; t < 3; t++) pos.push((x[t] + a * du[t] + b * dv[t] - origin[t]) * scale);
          nor.push(q[0] * s, q[1] * s, q[2] * s); col.push(color.r, color.g, color.b);
        }
        if (c > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * dims[u]] = 0;
        i += w; n += w;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// 멀리서 볼 때 쓰는 단순화 모형(LOD): 2 × 2 × 2 칸을 한 칸으로 줄인다. 색은 그 안에서 가장 많은 색, 부위 구분은 없앤다.
export function downsample(model) {
  const [sx, sy, sz] = model.size, Model = model.constructor;
  const out = new Model(Math.ceil(sx / 2), Math.ceil(sy / 2), Math.ceil(sz / 2));
  out.palette = model.palette.map((p) => (p ? { ...p } : null));
  const tally = new Map();
  for (let y = 0; y < out.size[1]; y++) for (let z = 0; z < out.size[2]; z++) for (let x = 0; x < out.size[0]; x++) {
    tally.clear(); let filled = 0, best = 0;
    for (let k = 0; k < 8; k++) {
      const c = model.get(2 * x + (k & 1), 2 * y + (k >> 1 & 1), 2 * z + (k >> 2));
      if (!c) continue;
      filled++; const t = (tally.get(c) ?? 0) + 1; tally.set(c, t);
      if (t > (tally.get(best) ?? 0) || !best) best = c;
    }
    if (filled >= 3) out.set(x, y, z, best, 1);        // 절반 가까이 찬 칸만 남김
  }
  return out;
}
