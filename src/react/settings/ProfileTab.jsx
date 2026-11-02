import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { TabsContent } from '@/components/ui/tabs';
import { MSG } from '../../common/constants.js';
import { sanitizeProfile } from '../../common/profile.js';
import { send } from '../../ui/ui-common.js';
import { Field, Panel } from './controls.jsx';

export default function ProfileTab({ score, materials, readMaterials, action, setDraft, extractMaterials, fileRef, resumeFile, paste, setPaste, extract, report, draft, applyDraft, profileTags, profileText, profileArea, setConfirm, flush, profileRef, setProfile }) {
  return <TabsContent value="profile" className="space-y-4">
        <Panel title="个人画像" description="上传简历自动抽取，或手动填写。画像越完整，AI 匹配越准。"><div className="flex flex-wrap items-center gap-4"><Badge variant="secondary" className="text-lg">{score.score}%</Badge><div><div className="font-medium">完整度 {score.completed}/{score.total} 项</div><p className="text-sm text-muted-foreground">{score.missing.length ? '待补充：' + score.missing.join('、') : '画像已相当完整'}</p></div></div></Panel>
        <Panel title="导入个人材料" description="可多选 Markdown / TXT，先在本机预览，再选择发送给当前 AI 抽取；也可直接导入画像 JSON，完全在本机处理。确认后才保存，合并会保留已有设置。">
          <Input type="file" aria-label="选择个人材料" accept=".md,.markdown,.txt,.json" multiple onChange={(e) => readMaterials(e.target.files)} />
          {materials.map((m, i) => <Field key={`${m.name}-${i}`} label={`${m.name}（${m.text.length} 字符）`}><Textarea rows={6} readOnly value={m.text} /></Field>)}
          {!!materials.length && (/\.json$/i.test(materials[0].name) ? <Button onClick={() => action(async () => setDraft(sanitizeProfile(JSON.parse(materials[0].text))))}>预览画像草稿</Button> : <Button onClick={extractMaterials}>发送材料给 AI 并抽取</Button>)}
        </Panel>
        <Panel title="上传简历，AI 自动填写" description="支持 PDF、DOCX、TXT。文件在本机解析；使用 AI 抽取时文本会发送至你配置的服务。抽取后需确认才写入画像。">
          <input ref={fileRef} className="hidden" type="file" accept=".pdf,.docx,.txt,.md,.json" onChange={(e) => { if (e.target.files[0]) resumeFile(e.target.files[0]); e.target.value = ''; }} />
          <div className="rounded-md border border-dashed p-6 text-center" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) resumeFile(e.dataTransfer.files[0]); }}><Button variant="outline" onClick={() => fileRef.current?.click()}>选择简历文件</Button><p className="mt-2 text-sm text-muted-foreground">也可拖拽文件到此处 · PDF / DOCX / TXT</p></div>
          <Textarea aria-label="简历文本" rows={4} placeholder="或在此粘贴简历文本…" value={paste} onChange={(e) => setPaste(e.target.value)} /><Button onClick={() => paste.trim() ? extract(paste.trim()) : report('请先粘贴简历文本', true)}>从文本抽取画像</Button>
          {draft && <div className="space-y-3 rounded-md border p-4"><h3 className="font-semibold">画像草稿（请核对后合并）</h3><p className="text-sm text-muted-foreground">合并时数组去重、保留已有单值，工作概述、项目概述和备注会追加新内容；可在下方手动编辑。</p><DraftPreview draft={draft} /><div className="flex flex-wrap gap-2"><Button onClick={() => applyDraft(false)}>合并到画像</Button><Button variant="outline" onClick={() => applyDraft(true)}>替换现有画像</Button><Button variant="ghost" onClick={() => setDraft(null)}>放弃</Button></div></div>}
        </Panel>
        <Panel title="手动编辑（自动保存）">
          <h3 className="font-semibold">求职目标</h3>{profileTags('目标岗位', 'target', 'jobTitles', '回车添加，如 前端工程师')}{profileTags('目标城市', 'target', 'cities', '如 广州')}<div className="grid gap-4 sm:grid-cols-3">{profileText('期望月薪下限(k)', 'target', 'salaryMinK', 'number', '如 15')}{profileText('期望月薪上限(k)', 'target', 'salaryMaxK', 'number', '如 25')}{profileText('工作年限', 'basics', 'yearsOfExperience', 'number', '如 3')}</div>{profileTags('目标行业', 'target', 'industries', '如 互联网')}{profileTags('期望公司规模', 'target', 'companySizes', '如 100-499人')}{profileTags('办公方式', 'target', 'workModes', '如 远程')}
          <h3 className="font-semibold">个人基础</h3><div className="grid gap-4 sm:grid-cols-2">{profileText('最高学历', 'basics', 'education', 'text', '如 本科')}{profileText('当前/最近职位', 'basics', 'currentTitle', 'text', '如 高级前端')}</div>{profileText('姓名（仅本地展示，默认不发送给 AI）', 'basics', 'name', 'text', '可留空')}
          <h3 className="font-semibold">能力与经历</h3>{profileTags('专业技能', 'capabilities', 'skills', '如 React、TypeScript')}{profileTags('优势亮点', 'capabilities', 'strengths', '一句一条')}{profileTags('行业经验', 'capabilities', 'industryExperience', '如 电商、金融')}{profileArea('工作经历概述', null, 'workSummary', '一段话概述工作经历')}{profileArea('项目经历概述', null, 'projectSummary', '代表性项目')}{profileTags('核心成就', null, 'highlights', '可量化的成果，一条一个')}
          <h3 className="font-semibold">偏好与禁区</h3>{profileTags('规避关键词', 'preference', 'avoidKeywords', '如 外包、驻场')}{profileTags('硬性排除', 'preference', 'dealbreakers', '如 需要出差')}{profileArea('给 AI 的额外说明', 'preference', 'notes', '任何想让 AI 知道的补充')}
        </Panel>
        <Panel title="一键清除画像" description="清空全部画像字段，并使已有匹配分缓存失效。不可撤销。"><Button variant="destructive" onClick={() => setConfirm({ title: '清除个人画像？', body: '将清空全部画像字段，并使已生成的岗位匹配分缓存失效。此操作不可撤销。', run: async () => { await flush('profile'); const p = await send(MSG.PROFILE_CLEAR); profileRef.current = p; setProfile(p); report('画像已清除'); } })}>清除画像</Button></Panel>
      </TabsContent>;
}

function DraftPreview({ draft: d }) {
  const rows = [['目标岗位', d.target.jobTitles], ['目标城市', d.target.cities], ['期望薪资', d.target.salaryMinK || d.target.salaryMaxK ? `${d.target.salaryMinK ?? ''}-${d.target.salaryMaxK ?? ''}k` : ''], ['工作年限', d.basics.yearsOfExperience != null ? `${d.basics.yearsOfExperience} 年` : ''], ['姓名', d.basics.name], ['目标行业', d.target.industries], ['公司规模', d.target.companySizes], ['办公方式', d.target.workModes], ['学历', d.basics.education], ['当前职位', d.basics.currentTitle], ['技能', d.capabilities.skills], ['优势', d.capabilities.strengths], ['行业经验', d.capabilities.industryExperience], ['工作概述', d.workSummary], ['项目概述', d.projectSummary], ['核心成就', d.highlights], ['规避关键词', d.preference.avoidKeywords], ['硬性排除', d.preference.dealbreakers], ['给 AI 的说明', d.preference.notes]];
  return <dl className="space-y-1 text-sm">{rows.filter(([, v]) => v && v.length).map(([label, value]) => <div key={label} className="whitespace-pre-wrap"><dt className="inline font-medium">{label}：</dt><dd className="inline">{Array.isArray(value) ? value.join('、') : value}</dd></div>)}</dl>;
}
