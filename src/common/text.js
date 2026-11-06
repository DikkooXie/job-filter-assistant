// 逗号/换行分隔字符串 -> 数组
export function toList(str) {
  return String(str || '')
    .split(/[,，、;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
