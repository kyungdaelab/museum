// 선물 아이템 목록 (3층: 선생님이 학생에게 주는 것. 학생이 직접 만들거나 고를 수 없다)
// 훈장은 여기에 없다: 선생님이 이름 · 모양 · 색을 정해 직접 만든다 (src/character/medal-shapes.js, DB 의 medals 표)
// ▸ 새 아이템 추가: ① 여기에 한 줄  ② src/character/items.js 의 BUILDERS 에 모양  ③ DB 의 student_items_known 목록(0008)에 id
export const ITEM_LIST = [
  { id: 'halo',  name: '후광',   icon: '😇', desc: '머리 위에 떠서 빛나는 금빛 고리' },
  { id: 'wings', name: '날개',   icon: '🪽', desc: '등 뒤에서 천천히 움직이는 하얀 날개' },
  { id: 'crown', name: '왕관',   icon: '👑', desc: '머리에 쓰는 금빛 왕관' },
  { id: 'cape',  name: '망토',   icon: '🦸', desc: '등 뒤로 늘어지는 붉은 망토' },
  { id: 'star',  name: '별가루', icon: '✨', desc: '몸 둘레를 도는 반짝이는 별가루' },
];
export const ITEM_IDS = ITEM_LIST.map((i) => i.id);
export const itemName = (id) => ITEM_LIST.find((i) => i.id === id)?.name ?? id;
