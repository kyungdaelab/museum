// 올리기 전에 브라우저에서 하는 일: 파일 종류 · 크기 확인, 이미지 줄이기(WebP), 썸네일 만들기
const MB = 1024 * 1024;
export const LIMITS = { image: 3 * MB, model: 15 * MB, splat: 30 * MB };             // 서버 함수 storage-files 와 같은 값
export const ACCEPT = { flat: '.jpg,.jpeg,.png,.webp', sculpture: '.glb,.spz,.ply' };   // 전시실 유형별로 고를 수 있는 파일
export const ACCEPT_LABEL = { flat: 'JPG · PNG · WebP 그림', sculpture: 'GLB 모델 · SPZ/PLY 스플랫' };
const EXT_KIND = { jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', glb: 'model', spz: 'splat', ply: 'splat' };
const IMAGE_SIDE = 2048, THUMB_SIDE = 360;

export const extOf = (name) => (name.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? '').toLowerCase();
export const baseName = (name) => name.replace(/\.[a-z0-9]{2,5}$/i, '');
export const kindOf = (file) => EXT_KIND[extOf(file.name)] ?? null;
const sizeText = (bytes) => (bytes / MB).toFixed(1) + 'MB';

// 크기 한도를 넘으면 쉬운 안내 문장, 괜찮으면 null
export function sizeProblem(kind, file) {
  if (file.size <= LIMITS[kind]) return null;
  if (kind === 'model')
    return `GLB 파일이 ${sizeText(file.size)} 입니다. 15MB 까지 올릴 수 있어요. 이렇게 줄여 보세요:\n`
      + ' ① gltf.report 사이트에 파일을 끌어다 놓고 Script 탭에서 압축(Draco 또는 Meshopt)과 텍스처 크기 줄이기(1024px)를 실행한 뒤 Export\n'
      + ' ② 스캔 앱에서 내보낼 때 "저용량 / Low / Web" 품질을 고르기\n'
      + ' ③ Blender 에서 Decimate 로 면 수를 줄이고 glTF Binary(.glb)로 다시 내보내기 (압축 옵션 켜기)';
  if (kind === 'splat')
    return `스플랫 파일이 ${sizeText(file.size)} 입니다. 30MB 까지 올릴 수 있어요. PLY 라면 SPZ 로 바꾸면 크기가 10분의 1 정도로 줄어듭니다. 스캔 앱에서 SPZ 로 내보내거나, 작품 주변만 남기고 잘라 내 다시 저장해 보세요.`;
  return `그림 파일이 ${sizeText(file.size)} 입니다. 줄인 뒤에도 3MB 를 넘어 올릴 수 없어요. 더 작은 사진으로 다시 시도해 주세요.`;
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
function draw(source, w, h, side) {
  const k = Math.min(1, side / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

// 그림: 긴 변 2048px 로 줄이고 WebP 로 바꾼다 + 썸네일.  반환 { file, thumb, note }
export async function optimizeImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);      // 휴대폰 사진의 회전 정보 반영
  if (!bitmap) throw new Error(`'${file.name}' 을(를) 그림으로 읽을 수 없어요. 파일이 깨졌거나 지원하지 않는 형식입니다.`);
  const from = `${bitmap.width}×${bitmap.height}`;
  const big = draw(bitmap, bitmap.width, bitmap.height, IMAGE_SIDE);
  let blob = null;
  for (const q of [0.86, 0.75, 0.6, 0.45]) { blob = await toBlob(big, q); if (blob && blob.size <= LIMITS.image) break; }      // 3MB 안에 들 때까지 화질을 낮춤
  const thumbBlob = await toBlob(draw(bitmap, bitmap.width, bitmap.height, THUMB_SIDE), 0.8);
  bitmap.close?.();
  if (!blob || !thumbBlob) throw new Error(`'${file.name}' 을(를) 변환하지 못했어요. 다른 브라우저(Chrome, Edge)에서 다시 시도해 주세요.`);
  const name = baseName(file.name);
  return {
    file: new File([blob], name + '.webp', { type: 'image/webp' }), thumb: new File([thumbBlob], name + '.webp', { type: 'image/webp' }),
    note: `${from} ${sizeText(file.size)} → ${big.width}×${big.height} ${sizeText(blob.size)}`,
  };
}

// 사진 한 장을 썸네일(WebP)로 (스플랫 작품의 대신 보여 줄 그림을 올릴 때)
export async function imageToThumb(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const blob = await toBlob(draw(bitmap, bitmap.width, bitmap.height, THUMB_SIDE * 2), 0.82);
  return new File([blob], baseName(file.name) + '.webp', { type: 'image/webp' });
}

// GLB: 3D 로 한 번 그려서 썸네일을 찍는다. 실패하면 null (썸네일 없이 올림)
export async function modelThumb(file) {
  const url = URL.createObjectURL(file);
  try {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
    const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/gltf/')).setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(THUMB_SIDE, THUMB_SIDE, false);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcbbfae, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-2, 4, 3); scene.add(sun);
    scene.add(gltf.scene);
    const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) || 1;
    camera.position.set(center.x + r * 1.3, center.y + r * 0.7, center.z + r * 1.9); camera.lookAt(center);
    renderer.render(scene, camera);
    const blob = await toBlob(renderer.domElement, 0.85);
    renderer.dispose(); renderer.forceContextLoss();
    return blob ? new File([blob], baseName(file.name) + '.webp', { type: 'image/webp' }) : null;
  } catch { return null; }
  finally { URL.revokeObjectURL(url); }
}

// 작품 정보 CSV(또는 표에서 복사한 글) 읽기 → Map(파일 이름(확장자 없이, 소문자) → { title, artist, grade, material, description })
//   첫 줄이 제목 줄이면 열 이름으로 맞추고(파일, 제목, 작가, 학년/반, 재료, 설명), 없으면 이 순서로 읽는다
export function parseArtworkCsv(text) {
  const rows = [];
  let cell = '', row = [], quoted = false;
  const sep = text.includes('\t') ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {            // 따옴표 안의 쉼표 · 줄바꿈을 지키며 나눔
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); cell = ''; if (row.some(Boolean)) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return { byFile: new Map(), inOrder: [] };
  const NAMES = { file: /파일|file/i, title: /제목|title/i, artist: /작가|이름|artist|name/i, grade: /학년|반|grade/i, material: /재료|material/i, description: /설명|desc/i };
  const head = rows[0], hasHead = head.some((h) => Object.values(NAMES).some((re) => re.test(h)));
  const order = ['file', 'title', 'artist', 'grade', 'material', 'description'];
  const col = Object.fromEntries(order.map((k, i) => [k, hasHead ? head.findIndex((h) => NAMES[k].test(h)) : i]));
  const byFile = new Map(), inOrder = [];
  for (const r of rows.slice(hasHead ? 1 : 0)) {
    const get = (k) => (col[k] >= 0 ? r[col[k]] ?? '' : '');
    const meta = { title: get('title'), artist: get('artist'), grade: get('grade'), material: get('material'), description: get('description') };
    const f = baseName(get('file')).toLowerCase();
    if (f) byFile.set(f, meta);
    inOrder.push(meta);
  }
  return { byFile, inOrder };
}
