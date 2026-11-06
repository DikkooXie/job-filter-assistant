import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toList } from '../../common/text.js';

export function Field({ label, children }) {
  return <label className="grid gap-2 text-sm font-medium">{label}{children}</label>;
}
export function Panel({ title, description, children }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>;
}
export function Choice({ value, onValueChange, options, label }) {
  return <Select value={value} onValueChange={onValueChange}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{options.map(([v, text]) => <SelectItem key={v} value={v}>{text}</SelectItem>)}</SelectContent></Select>;
}
export function Tags({ value = [], onChange, placeholder, label }) {
  const [input, setInput] = useState('');
  const commit = () => {
    const next = [...value];
    for (const part of toList(input)) if (!next.some((v) => v.toLowerCase() === part.toLowerCase())) next.push(part);
    if (next.length !== value.length) onChange(next);
    setInput('');
  };
  return <div className="flex flex-wrap items-center gap-2 rounded-md border border-input p-2">
    {value.map((v, i) => <Badge key={`${v}-${i}`} variant="secondary" className="gap-1">{v}<button type="button" aria-label={`删除 ${v}`} onClick={() => onChange(value.filter((_, n) => n !== i))}>×</button></Badge>)}
    <Input aria-label={label} className="min-w-32 flex-1 border-0 shadow-none" placeholder={placeholder || '回车添加'} value={input} onChange={(e) => setInput(e.target.value)} onBlur={commit} onKeyDown={(e) => {
      if (['Enter', ',', '，'].includes(e.key)) { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !input && value.length) onChange(value.slice(0, -1));
    }} />
  </div>;
}
export function ToggleRow({ label, description, checked, onChange }) {
  return <div className="flex items-center justify-between gap-4 border-b py-3 last:border-0"><div><div className="text-sm font-medium">{label}</div>{description && <p className="text-sm text-muted-foreground">{description}</p>}</div><Switch aria-label={label} checked={!!checked} onCheckedChange={onChange} /></div>;
}
