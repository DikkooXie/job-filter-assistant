import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TabsContent } from '@/components/ui/tabs';
import { MODE, MSG } from '../../common/constants.js';
import { send } from '../../ui/ui-common.js';
import UpdatePanel from '../UpdatePanel.jsx';
import { Field, Panel, Choice, ToggleRow } from './controls.jsx';

export default function GeneralTab({ settings, updateSettings, exportData, setConfirm, report }) {
  return <TabsContent value="general" className="space-y-4"><Panel title="运行模式" description="自动 = 跟随当前站点；也可锁定只看某个平台。"><Choice label="运行模式" value={settings.mode} onValueChange={(mode) => updateSettings({ mode })} options={[[MODE.auto, '自动'], [MODE.boss, 'BOSS 直聘'], [MODE.qcwy, '前程无忧']]} /></Panel><Panel title="抓取与分析">{[['autoCapture', '自动收录岗位', '浏览列表时自动抓取'], ['autoScore', '自动 AI 分析', '新收录岗位自动打分（消耗 token）'], ['showBadge', '显示收录角标', '收录岗位时在页面右下角短暂显示。'], ['dedupe', '合并重复岗位', '']].map(([key, label, desc]) => <ToggleRow key={key} label={label} description={desc} checked={settings[key]} onChange={(v) => updateSettings({ [key]: v })} />)}<Field label="岗位库上限（超出按时间淘汰，收藏不淘汰）"><Input type="number" value={settings.maxJobs} onChange={(e) => updateSettings({ maxJobs: Number(e.target.value) || 800 })} /></Field></Panel><Panel title="隐私" description="API Key 和数据保存在本机；使用 AI 时相关内容会发送至所配置的服务。脱敏无法保证移除所有个人信息。"><ToggleRow label="发送前脱敏" description="隐去手机号、邮箱、联系方式、个人链接等" checked={settings.privacy.redactPII} onChange={(v) => updateSettings({ privacy: { redactPII: v } })} /><ToggleRow label="发送岗位公司名" description="公司名一般为公开招聘信息，发送可提升分析质量" checked={settings.privacy.sendCompanyName} onChange={(v) => updateSettings({ privacy: { sendCompanyName: v } })} /><ToggleRow label="发送招呼语前确认" checked={settings.privacy.confirmBeforeSend} onChange={(v) => updateSettings({ privacy: { confirmBeforeSend: v } })} /></Panel><Panel title="数据"><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => exportData('json')}>导出岗位 (JSON)</Button><Button variant="outline" onClick={() => exportData('csv')}>导出岗位 (CSV)</Button><Button variant="destructive" onClick={() => setConfirm({ title: '清空岗位库？', body: '删除全部已收录岗位，不可撤销。', run: async () => { await send(MSG.JOB_CLEAR_REQUEST); report('已清空'); } })}>清空岗位库</Button></div></Panel><UpdatePanel onConfirm={setConfirm} /></TabsContent>;
}
