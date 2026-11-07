// 项目内统一的 className 合并函数。shadcn 组件和页面都从这里导入，不直接用 `cn` 包。
//
// 为什么不直接用 `cn` 包：它按 Tailwind 默认主题判断类名归属，不认识 globals.css 里自定义的
// 字号令牌（text-body、text-control……），会把它们当成文字颜色，和 text-ink-1 一起出现时
// 直接丢掉字号。这里把这些名字登记为 font-size，新增 `--text-*` 令牌时要同步加到下面。
import { createCn } from 'cn/config';

export const SIZE_TOKENS = ['micro', 'hint', 'note', 'control', 'body', 'section'] as const;

export const cn = createCn({
  extend: { classGroups: { 'font-size': [{ text: [...SIZE_TOKENS] }] } },
});
