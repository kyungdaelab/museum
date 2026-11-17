// 공간 확인용 테스트 전시실: 모든 자리를 임시 작품으로 채운 전시실 설정과 작품 목록을 만든다.
// (실제 전시실 데이터와는 무관. 입체 작품은 샘플 전시실의 파일을 빌려 씀)
const SOLID = 'assets/rooms/solid-sample/';
const MODELS = [
  { type: 'model', model: SOLID + 'sample-tower.glb', sizeCm: { height: 120 }, rotation: [0, 0, 90], title: '쌓기 탑' },
  { type: 'model', model: SOLID + 'sample-vase.glb', sizeCm: { height: 45 }, title: '화병' },
  { type: 'model', model: SOLID + 'sample-ring.glb', sizeCm: { width: 40 }, title: '고리' },
];
const SPLATS = [
  { type: 'splat', splat: SOLID + 'sample-snowman.ply', thumbnail: SOLID + 'sample-snowman.svg', sizeCm: { height: 60 }, rotation: [180, 0, 0],
    crop: { type: 'cylinder', center: [3, 2], radius: 1.2, yMin: -0.96 }, title: '눈사람' },
  { type: 'splat', splat: SOLID + 'sample-spiral.ply', thumbnail: SOLID + 'sample-spiral.svg', sizeCm: { height: 90 },
    crop: { type: 'box', min: [-0.55, 0.01, -0.55], max: [0.55, 1.6, 0.55] }, title: '소용돌이 기둥' },
  { type: 'splat', splat: SOLID + 'sample-mushroom.ply', thumbnail: SOLID + 'sample-mushroom.svg', sizeCm: { height: 35 },
    crop: { type: 'cylinder', center: [-1, 4], radius: 0.3, yMin: 0.305 }, title: '버섯' },
];
const SIZES = [[640, 480], [480, 640], [560, 560], [800, 450], [440, 660]];      // 가로·세로 비율을 섞어서 간격 확인
const FRAMES = ['black', 'white', 'wood', 'walnut', 'gold'];

function testImage(no) {             // 번호가 크게 적힌 임시 그림
  const [w, h] = SIZES[no % SIZES.length];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), hue = (no * 47) % 360;
  g.fillStyle = `hsl(${hue}, 55%, 78%)`; g.fillRect(0, 0, w, h);
  g.fillStyle = `hsl(${(hue + 40) % 360}, 60%, 62%)`; g.beginPath(); g.arc(w * 0.7, h * 0.3, Math.min(w, h) * 0.22, 0, Math.PI * 2); g.fill();
  g.fillStyle = `hsl(${(hue + 200) % 360}, 45%, 45%)`; g.fillRect(0, h * 0.72, w, h * 0.28);
  g.fillStyle = 'rgba(255,255,255,.92)'; g.font = `700 ${Math.min(w, h) * 0.42}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(no, w / 2, h / 2);
  return c.toDataURL('image/jpeg', 0.8);
}

// type: 'flat' | 'solid', count: 작품 수, opts: { arrangement, theme }
export function makeTestRoom(type, count, opts = {}) {
  const config = {
    id: 'test', title: `테스트 전시실 (${type === 'flat' ? '평면' : '입체'} ${count}점)`, teacher: '테스트 교사',
    period: { start: '2026-01-01', end: '2026-12-31' },
    description: '공간이 작품 수에 맞게 만들어지는지 확인하기 위한 임시 전시실입니다. 모든 자리가 임시 작품으로 채워져 있고 자리 번호가 표시됩니다.',
    type, maxArtworks: count, arrangement: opts.arrangement, theme: opts.theme,
  };
  const artworks = Array.from({ length: count }, (_, i) => {
    const no = i + 1, base = { id: `test-${no}`, slot: no, artist: '테스트', grade: '', material: '임시 작품', description: `${no}번 자리에 놓인 임시 작품입니다.` };
    if (type === 'flat') return { ...base, type: 'image', title: `임시 그림 ${no}`, size: '', image: testImage(no), frameColor: FRAMES[i % FRAMES.length] };
    const src = no % 5 === 0 ? SPLATS[(no / 5 - 1) % SPLATS.length] : MODELS[i % MODELS.length];     // 5번째마다 스플랫
    return { ...base, ...src, title: `${src.title} ${no}`, size: '' };
  });
  return { config, artworks };
}
