// 逗号/换行分隔字符串 -> 数组
export function toList(value: unknown): string[] {
  return String(value || '')
    .split(/[,，、;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
