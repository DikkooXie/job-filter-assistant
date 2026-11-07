// 侧栏按钮的两个基础配方。`.job-panel button` 的未分层重置（font、color、border、
// background、padding）会压过普通工具类，所以它设置过的属性都带 `!`。
// 焦点环由 `.job-panel :focus-visible` 统一提供，这里不重复声明。
export const btn = 'inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] !border !border-jp-line-strong !bg-jp-field !px-2.5 !py-[5px] !text-[12px] !font-[550] !text-jp-ink enabled:hover:!border-jp-muted enabled:hover:!bg-jp-inset enabled:hover:!text-jp-ink disabled:opacity-[.48]';
export const btnPrimary = '!border-jp-accent !bg-jp-accent !text-jp-on-accent enabled:hover:!border-[color:color-mix(in_srgb,var(--jp-accent)_88%,var(--jp-ink))] enabled:hover:!bg-[color:color-mix(in_srgb,var(--jp-accent)_88%,var(--jp-ink))] enabled:hover:!text-jp-on-accent';
