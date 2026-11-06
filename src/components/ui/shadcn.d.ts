// shadcn 组件目前仍是 JS 源码，解构参数没有类型，TypeScript 会把没写默认值的
// className / children 推断成必填，导致 TSX 页面里正常的 JSX 报错。
// 这里按模块声明宽松类型，让页面代码可以照常使用；组件本身迁到 TSX 后删除对应声明即可。
declare module '@/components/ui/alert-dialog' {
  export const AlertDialog: any;
  export const AlertDialogTrigger: any;
  export const AlertDialogPortal: any;
  export const AlertDialogOverlay: any;
  export const AlertDialogContent: any;
  export const AlertDialogHeader: any;
  export const AlertDialogFooter: any;
  export const AlertDialogTitle: any;
  export const AlertDialogDescription: any;
  export const AlertDialogAction: any;
  export const AlertDialogCancel: any;
}

declare module '@/components/ui/badge' {
  export const Badge: any;
  export const badgeVariants: any;
}

declare module '@/components/ui/button' {
  export const Button: any;
  export const buttonVariants: any;
}

declare module '@/components/ui/card' {
  export const Card: any;
  export const CardHeader: any;
  export const CardTitle: any;
  export const CardDescription: any;
  export const CardAction: any;
  export const CardContent: any;
  export const CardFooter: any;
}

declare module '@/components/ui/dialog' {
  export const Dialog: any;
  export const DialogTrigger: any;
  export const DialogPortal: any;
  export const DialogClose: any;
  export const DialogOverlay: any;
  export const DialogContent: any;
  export const DialogHeader: any;
  export const DialogFooter: any;
  export const DialogTitle: any;
  export const DialogDescription: any;
}

declare module '@/components/ui/input' {
  export const Input: any;
}

declare module '@/components/ui/select' {
  export const Select: any;
  export const SelectGroup: any;
  export const SelectValue: any;
  export const SelectTrigger: any;
  export const SelectContent: any;
  export const SelectLabel: any;
  export const SelectItem: any;
  export const SelectSeparator: any;
  export const SelectScrollUpButton: any;
  export const SelectScrollDownButton: any;
}

declare module '@/components/ui/sonner' {
  export const Toaster: any;
  export const toast: any;
}

declare module '@/components/ui/switch' {
  export const Switch: any;
}

declare module '@/components/ui/tabs' {
  export const Tabs: any;
  export const TabsList: any;
  export const TabsTrigger: any;
  export const TabsContent: any;
  export const tabsListVariants: any;
}

declare module '@/components/ui/textarea' {
  export const Textarea: any;
}
