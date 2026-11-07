// 设置页各标签页共用的样式配方（Tailwind 类名）。
//
// 颜色、阴影、字号令牌（bg-field、text-ink-3、shadow-focus、text-body……）定义在 globals.css 的
// 「设置页令牌」；断点 wide: 表示宽于 860px。只有一个标签页用到的样式就近写在组件里，
// 两处以上重复的才收进这里。
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

/** 键盘聚焦环：2px 品牌色描边 + 外圈柔光。鼠标点击不出现。 */
export const focusRing = 'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand focus-visible:shadow-focus';

/** 分组标题（每组的 h2）。 */
export const groupTitle = 'mb-3.5 text-section leading-[1.45] font-semibold text-ink-1';

/** 一行设置的标题文字。 */
export const rowTitle = 'text-body leading-normal font-medium text-ink-1';

/** 标题下方的灰色说明。 */
export const hint = 'text-hint leading-[1.6] text-ink-3';

/**
 * 设置页按钮。默认描边款；primary 深色实心，ghost 无边框，danger 红字描边。
 *
 * cva 只拼接不合并：基础类和变体里同时有 text-* / h-* 时，生效的是 Tailwind 输出顺序靠后的那个，
 * 不是写在后面的那个。所以导出的 button() 再过一遍 cn()，让变体稳定覆盖基础类。
 * 边框颜色只写在变体里（cn 对任意值的边框颜色归类不可靠）。danger 的描边沿用原样式的 srgb 混色，
 * Tailwind 的 /32 写法用 oklab 混，颜色会偏一点。
 */
const buttonVariants = cva([
  'inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border px-3',
  'text-control leading-none font-medium whitespace-nowrap text-ink-1',
  'disabled:cursor-not-allowed disabled:opacity-45',
  focusRing,
], {
  variants: {
    variant: {
      primary: 'border-transparent bg-btn text-btn-ink enabled:hover:opacity-92',
      outline: 'border-line-strong bg-surface enabled:hover:bg-surface-2',
      ghost: 'border-transparent text-ink-2 enabled:hover:bg-surface-2',
      danger: 'border-[color-mix(in_srgb,var(--s-down)_32%,transparent)] bg-transparent text-danger enabled:hover:bg-danger-soft',
    },
    size: {
      md: '',
      sm: 'h-7 px-2.5',
    },
  },
  defaultVariants: { variant: 'outline', size: 'md' },
});

export const button = (props?: VariantProps<typeof buttonVariants>) => cn(buttonVariants(props));

/** 开关：原生 checkbox 去掉外观后画成胶囊，::after 是圆形滑块。配合 role="switch" 使用。 */
export const switchInput = [
  'relative h-[21px] w-9 flex-none cursor-pointer appearance-none rounded-full bg-switch-off checked:bg-brand',
  'after:absolute after:top-[3px] after:left-[3px] after:size-[15px] after:rounded-full after:bg-[#f7fbfa]',
  'after:shadow-[0_1px_2px_rgba(16,28,34,.28)] after:transition-transform after:duration-120 after:ease-[ease]',
  'checked:after:translate-x-[15px] motion-reduce:after:transition-none',
  'focus:outline-none',
  focusRing,
].join(' ');

/** 单选卡片：外层 label 加 choiceCard，里面的 radio 用 sr-only 隐藏，圆点用 choiceDot。 */
export const choiceCard = [
  'group relative flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-line bg-field',
  'text-body leading-normal font-medium text-ink-1',
  'has-checked:border-brand-line has-checked:bg-brand-soft',
  'has-focus-visible:outline-solid has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand has-focus-visible:shadow-focus',
  'has-disabled:cursor-not-allowed has-disabled:opacity-45',
].join(' ');

export const choiceDot = 'box-border size-3.5 flex-none rounded-full border border-line-strong group-has-checked:border-brand group-has-checked:bg-brand';
