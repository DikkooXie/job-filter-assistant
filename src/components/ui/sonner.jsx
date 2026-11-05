"use client"

import { Toaster as Sonner, toast } from "sonner"

/** 侧栏反馈条。颜色由 .job-panel 的 Sonner 变量覆盖，不用 richColors 的成功绿。 */
function Toaster({
  ...props
}) {
  return (
    <Sonner
      theme="system"
      position="bottom-center"
      visibleToasts={3}
      closeButton={false}
      richColors={false}
      duration={2600}
      gap={8}
      offset={14}
      mobileOffset={14}
      style={{
        "--normal-bg": "var(--jp-surface-2)",
        "--normal-text": "var(--jp-ink)",
        "--normal-border": "var(--jp-line)",
        "--border-radius": "10px",
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
