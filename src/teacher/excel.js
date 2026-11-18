// 엑셀 파일 다루기: 양식(.xlsx) 내려받기 · 올린 엑셀 파일을 글(쉼표로 나눈 줄)로 바꾸기
// 엑셀을 읽고 쓰는 라이브러리(SheetJS)는 처음 쓸 때만 내려받는다.
let lib = null;
const load = () => (lib ??= import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'));

export const isExcel = (file) => /\.(xlsx|xls)$/i.test(file?.name ?? '');

// 양식 내려받기. headers = 첫 줄 제목들, rows = 예시 줄들, widths = 칸 너비(글자 수)
export async function downloadTemplate(filename, headers, rows = [], widths = []) {
  const XLSX = await load();
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet['!cols'] = headers.map((h, i) => ({ wch: widths[i] ?? Math.max(10, String(h).length * 2 + 2) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '양식');
  const bytes = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// 올린 파일 → 글. 엑셀이면 첫 번째 시트를 '칸, 칸, 칸' 줄들로 바꾸고, 그 밖(CSV · TXT)은 그대로 읽는다
export async function fileToText(file) {
  if (!isExcel(file)) return file.text();
  const XLSX = await load();
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return '';
  return XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).replace(/\r/g, '').split('\n').filter((line) => line.replace(/,/g, '').trim()).join('\n');
}
