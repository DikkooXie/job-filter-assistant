import React from 'react';
import { Input } from '@/components/ui/input';
import { TabsContent } from '@/components/ui/tabs';
import { Field, Panel, Tags, ToggleRow } from './controls.jsx';

export default function FiltersTab({ settings, updateSettings }) {
  const f = settings.filters;
  const filterTags = (label, key, placeholder) => <div className="space-y-2"><div className="text-sm font-medium">{label}</div><Tags label={label} value={f[key]} placeholder={placeholder} onChange={(v) => updateSettings({ filters: { [key]: v } })} /></div>;
  return <TabsContent value="filters" className="space-y-4"><Panel title="岗位筛选" description="本地规则先过一遍（不消耗 AI）。命中排除词或不满足条件的岗位不进入列表。"><ToggleRow label="启用本地筛选" description="关闭时收录全部岗位，仅标注风险词" checked={f.enabled} onChange={(v) => updateSettings({ filters: { enabled: v } })} /></Panel><Panel title="关键词">{filterTags('包含关键词（配置后须命中任一）', 'keywordsInclude', '如 前端、React')}{filterTags('排除关键词（命中即剔除）', 'keywordsExclude', '如 电销、催收')}{filterTags('风险词（仅标注不剔除）', 'riskKeywords', '如 外包、驻场')}{filterTags('屏蔽公司（公司名含即剔除）', 'excludeCompanies', '公司名关键词')}</Panel><Panel title="条件">{filterTags('城市（含任一即保留）', 'cities', '如 广州、深圳')}<div className="grid gap-4 sm:grid-cols-2">{[['salaryMinK', '薪资下限(k/月)', '如 12'], ['salaryMaxK', '薪资上限(k/月)', '如 30']].map(([key, label, ph]) => <Field key={key} label={label}><Input type="number" placeholder={ph} value={f[key] ?? ''} onChange={(e) => updateSettings({ filters: { [key]: e.target.value === '' ? null : Number(e.target.value) } })} /></Field>)}</div>{filterTags('经验偏好（软提示）', 'experience', '如 1-3年')}{filterTags('学历偏好（软提示）', 'degrees', '如 本科')}</Panel></TabsContent>;
}
