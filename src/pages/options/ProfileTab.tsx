import React, { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toList } from '../../common/text.js';
import { getDealbreakers, updateDealbreakers } from '../../common/profile.js';
import type { Profile } from '../../common/types.js';
import type { Report } from './types.js';
import { cn } from '../../lib/cn.js';
import { button, fieldGrid, fieldHint, fieldLabel, focusRing, groupTitle, hint, tagBox, tagChip, tagInput } from './recipes.js';

/** 分组：组与组之间一条分隔线，第一组贴顶。 */
const group = 'mt-7 mb-[30px] border-t border-line pt-7 first:mt-0 first:border-t-0 first:pt-0';

/** 分组说明；紧跟在标题后时往上收 8px。 */
const groupNote = 'm-0 text-note leading-[1.65] text-ink-3';

const fields = 'flex flex-col gap-[11px]';

/** 单行输入框、数字框、多行文本共用的外观。 */
const control = 'rounded-lg border border-line-strong bg-field text-body text-ink-1 focus:border-brand focus:shadow-focus focus:outline-none';
const textInput = `${control} h-9 w-full px-2.5 placeholder:text-ink-3`;
const numberInput = `${control} h-[34px] w-[88px] px-2.5`;
const areaInput = `${control} min-h-[76px] w-full resize-y px-2.5 py-2 leading-[1.6] placeholder:text-ink-3`;

/** 导入方式分段：灰底胶囊里一排按钮，选中的那格浮起。 */
const segmentItem = [
  'h-7 cursor-pointer rounded-[7px] border border-transparent bg-transparent px-3 text-control leading-none font-normal text-ink-2',
  'focus-visible:border-brand focus-visible:shadow-focus focus-visible:outline-none',
  'aria-checked:border-line aria-checked:bg-surface aria-checked:font-medium aria-checked:text-ink-1 aria-checked:shadow-card',
].join(' ');

/** 拖放区：虚线框，悬停或拖入文件时换成品牌浅色。 */
const dropzone = 'relative flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-strong bg-surface-2 px-[22px] py-[26px] text-center hover:border-brand-line hover:bg-brand-soft';

/** 「抽取画像」：品牌色实心，比通用按钮更醒目。 */
const pasteSubmit = cn(
  'h-8 flex-none cursor-pointer rounded-lg border border-transparent bg-brand px-3',
  'text-control leading-none font-medium whitespace-nowrap text-on-brand hover:bg-[color-mix(in_srgb,var(--s-accent)_86%,var(--s-ink-1))]',
  focusRing,
);

const draftButton = 'min-h-[38px]';

type ImportMode = 'resume' | 'paste' | 'json';

const IMPORT_MODES: ReadonlyArray<{ id: ImportMode; label: string }> = [
  { id: 'resume', label: '简历文件' },
  { id: 'paste', label: '粘贴文本' },
  { id: 'json', label: '画像 JSON' },
];

type ProfileGroup = 'target' | 'basics' | 'capabilities' | 'preference';

type DraftValue = string | string[] | undefined;

const DRAFT_ROWS: ReadonlyArray<readonly [string, (draft: Profile) => DraftValue]> = [
  ['目标岗位', (d) => d.target.jobTitles],
  ['目标城市', (d) => d.target.cities],
  ['期望薪资', (d) => (d.target.salaryMinK || d.target.salaryMaxK ? `${d.target.salaryMinK ?? ''}-${d.target.salaryMaxK ?? ''}k` : '')],
  ['工作年限', (d) => (d.basics.yearsOfExperience != null ? `${d.basics.yearsOfExperience} 年` : '')],
  ['姓名', (d) => d.basics.name],
  ['目标行业', (d) => d.target.industries],
  ['公司规模', (d) => d.target.companySizes],
  ['办公方式', (d) => d.target.workModes],
  ['学历', (d) => d.basics.education],
  ['当前职位', (d) => d.basics.currentTitle],
  ['技能', (d) => d.capabilities.skills],
  ['优势', (d) => d.capabilities.strengths],
  ['行业经验', (d) => d.capabilities.industryExperience],
  ['工作概述', (d) => d.workSummary],
  ['项目概述', (d) => d.projectSummary],
  ['核心成就', (d) => d.highlights],
  ['雷点', (d) => getDealbreakers(d.preference)],
  ['给 AI 的说明', (d) => d.preference.notes],
];

export interface ProfileTabProps {
  profile: Profile;
  draft: Profile | null;
  report: Report;
  onEdit: (group: ProfileGroup | null, key: string, value: unknown) => void;
  onImportFiles: (files: File[], mode: ImportMode) => void;
  onExtractText: (text: string) => void;
  onApplyDraft: (replace: boolean) => void;
  onDiscardDraft: () => void;
  onClear: () => void;
}

export default function ProfileTab({ profile, draft, report, onEdit, onImportFiles, onExtractText, onApplyDraft, onDiscardDraft, onClear }: ProfileTabProps) {
  const [mode, setMode] = useState<ImportMode>('resume');
  const [paste, setPaste] = useState('');
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const valueOf = (group: ProfileGroup | null, key: string): string | number | null => {
    const scope = group ? (profile[group] as unknown as Record<string, unknown>) : (profile as unknown as Record<string, unknown>);
    const value = scope[key];
    return typeof value === 'string' || typeof value === 'number' ? value : null;
  };
  const editText = (group: ProfileGroup | null, key: string, type: 'text' | 'number' = 'text') => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const raw = event.target.value;
    onEdit(group, key, type === 'number' ? (raw === '' ? null : Number(raw)) : raw);
  };
  const takeFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length) onImportFiles(files, mode);
  };

  return <TabsContent value="profile" className="min-w-0">
    <section className={group}>
      <h2 className={groupTitle}>导入材料</h2>
      <p className={`${groupNote} -mt-2 mb-3.5`}>抽取时文本会发给当前启用的 AI，确认后才写入画像。</p>
      <div className={fields}>
        <div className="inline-flex flex-wrap rounded-[9px] bg-well p-[3px]" role="radiogroup" aria-label="导入方式">
          {IMPORT_MODES.map((item) => <button key={item.id} type="button" className={segmentItem} role="radio" aria-checked={mode === item.id} onClick={() => setMode(item.id)}>{item.label}</button>)}
        </div>
        {mode === 'paste' ? <div className="flex flex-col overflow-hidden rounded-[14px] border border-line-strong bg-field focus-within:border-brand focus-within:shadow-focus">
          <textarea className="min-h-[200px] w-full resize-y bg-transparent px-3.5 pt-3.5 pb-4 text-body leading-[1.6] text-ink-1 outline-none placeholder:text-ink-3" aria-label="简历文本" placeholder="在此粘贴简历文本" value={paste} onChange={(event) => setPaste(event.target.value)} />
          <div className="flex items-center justify-between gap-2 border-t border-line bg-well px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-3 text-hint leading-[1.4] text-ink-3">
              <span className="whitespace-nowrap tabular-nums">{paste.length} 字</span>
              <button type="button" className="cursor-pointer bg-transparent p-0 text-hint leading-[1.4] whitespace-nowrap text-ink-2 hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand focus-visible:outline-solid" onClick={() => setPaste('')}>清空</button>
            </div>
            <button type="button" className={pasteSubmit} onClick={() => {
              const text = paste.trim();
              if (!text) report('请先粘贴简历文本', true);
              else onExtractText(text);
            }}>抽取画像</button>
          </div>
        </div> : <div
          className={cn(dropzone, over && 'border-brand-line bg-brand-soft')}
          onDragEnter={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); dragDepth.current += 1; setOver(true); }}
          onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setOver(false); }}
          onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); dragDepth.current = 0; setOver(false); takeFiles(event.dataTransfer.files); }}
        >
          <input
            ref={fileRef}
            className="absolute size-px overflow-hidden [clip:rect(0_0_0_0)]"
            tabIndex={-1}
            type="file"
            aria-label={mode === 'json' ? '选择画像 JSON' : '选择简历文件'}
            accept={mode === 'json' ? '.json,application/json' : '.pdf,.docx,.doc,.txt,.md,.markdown'}
            multiple={mode !== 'json'}
            onChange={(event) => { takeFiles(event.target.files); event.target.value = ''; }}
          />
          <button type="button" className={button()} onClick={() => fileRef.current?.click()}>选择文件</button>
          <p className={hint}>{mode === 'json' ? '选择或拖入一个画像 JSON' : '选择或拖入 PDF、DOCX；MD / TXT 可一次多选'}</p>
        </div>}
        {draft && <DraftPreview draft={draft} onApply={onApplyDraft} onDiscard={onDiscardDraft} />}
      </div>
    </section>

    <section className={group}>
      <h2 className={groupTitle}>求职目标</h2>
      <div className={fields}>
        <ProfileTags label="目标岗位" value={profile.target.jobTitles} placeholder="回车添加，如 前端工程师" onChange={(next) => onEdit('target', 'jobTitles', next)} />
        <ProfileTags label="目标城市" value={profile.target.cities} placeholder="回车添加，如 广州" note="符合的岗位匹配分更高" onChange={(next) => onEdit('target', 'cities', next)} />
        <ProfileField label="期望月薪" note="只用于匹配打分，不会写进招呼语">
          <div className="flex flex-wrap items-center gap-2">
            <input className={numberInput} type="number" aria-label="期望月薪下限" placeholder="下限" value={profile.target.salaryMinK ?? ''} onChange={editText('target', 'salaryMinK', 'number')} />
            <span aria-hidden="true">—</span>
            <input className={numberInput} type="number" aria-label="期望月薪上限" placeholder="上限" value={profile.target.salaryMaxK ?? ''} onChange={editText('target', 'salaryMaxK', 'number')} />
            <span className="text-control text-ink-3">k/月</span>
          </div>
        </ProfileField>
        <ProfileTags label="目标行业" value={profile.target.industries} placeholder="回车添加，如 互联网" onChange={(next) => onEdit('target', 'industries', next)} />
        <ProfileTags label="公司规模" value={profile.target.companySizes} placeholder="回车添加，如 100-499人" onChange={(next) => onEdit('target', 'companySizes', next)} />
        <ProfileTags label="办公方式" value={profile.target.workModes} placeholder="回车添加，如 远程" onChange={(next) => onEdit('target', 'workModes', next)} />
      </div>
    </section>

    <section className={group}>
      <h2 className={groupTitle}>个人基础</h2>
      <div className={fields}>
        <ProfileField label="最高学历" htmlFor="profile-education">
          <input id="profile-education" className={textInput} placeholder="如 本科" value={valueOf('basics', 'education') || ''} onChange={editText('basics', 'education')} />
        </ProfileField>
        <ProfileField label="当前或最近职位" htmlFor="profile-current-title">
          <input id="profile-current-title" className={textInput} placeholder="如 高级前端" value={valueOf('basics', 'currentTitle') || ''} onChange={editText('basics', 'currentTitle')} />
        </ProfileField>
        <ProfileField label="姓名" htmlFor="profile-name">
          <input id="profile-name" className={textInput} placeholder="留空即不填" value={valueOf('basics', 'name') || ''} onChange={editText('basics', 'name')} />
        </ProfileField>
        <ProfileField label="工作年限" htmlFor="profile-years">
          <input id="profile-years" className={numberInput} type="number" placeholder="如 3" value={valueOf('basics', 'yearsOfExperience') ?? ''} onChange={editText('basics', 'yearsOfExperience', 'number')} />
        </ProfileField>
      </div>
    </section>

    <section className={group}>
      <h2 className={groupTitle}>能力与经历</h2>
      <div className={fields}>
        <ProfileTags label="专业技能" value={profile.capabilities.skills} placeholder="回车添加，如 React" onChange={(next) => onEdit('capabilities', 'skills', next)} />
        <ProfileTags label="优势亮点" value={profile.capabilities.strengths} placeholder="回车添加" onChange={(next) => onEdit('capabilities', 'strengths', next)} />
        <ProfileTags label="行业经验" value={profile.capabilities.industryExperience} placeholder="回车添加，如 电商" onChange={(next) => onEdit('capabilities', 'industryExperience', next)} />
        <ProfileField label="工作经历概述" htmlFor="profile-work">
          <textarea id="profile-work" className={areaInput} placeholder="一段话概述工作经历" value={valueOf(null, 'workSummary') || ''} onChange={editText(null, 'workSummary')} />
        </ProfileField>
        <ProfileField label="项目经历概述" htmlFor="profile-project" note="AI 撰写招呼语时只会引用这里写到的事实">
          <textarea id="profile-project" className={areaInput} placeholder="代表性项目" value={valueOf(null, 'projectSummary') || ''} onChange={editText(null, 'projectSummary')} />
        </ProfileField>
        <ProfileTags label="核心成就" value={profile.highlights} placeholder="回车添加" onChange={(next) => onEdit(null, 'highlights', next)} />
      </div>
    </section>

    <section className={group}>
      <h2 className={groupTitle}>偏好与禁区</h2>
      <div className={fields}>
        <ProfileTags label="雷点" value={getDealbreakers(profile.preference)} placeholder="回车添加，如 外包、大小周" note="字面或 AI 语义命中都会降低匹配分，岗位仍会保留" onChange={(next) => onEdit(null, 'preference', updateDealbreakers(profile.preference, next))} />
        <ProfileField label="给 AI 的说明" htmlFor="profile-notes">
          <textarea id="profile-notes" className={areaInput} value={valueOf('preference', 'notes') || ''} onChange={editText('preference', 'notes')} />
        </ProfileField>
      </div>
    </section>

    <section className={group}>
      <div className="flex flex-col items-start justify-between gap-4 wide:flex-row wide:items-center">
        <div>
          <h2>清除画像</h2>
          <p className={`${groupNote} mt-1`}>清空全部画像字段，并使已有匹配分缓存失效。不可撤销。</p>
        </div>
        <button type="button" className={button({ variant: 'danger' })} onClick={onClear}>清除画像</button>
      </div>
    </section>
  </TabsContent>;
}

interface ProfileFieldProps {
  label: string;
  note?: string;
  htmlFor?: string;
  children?: ReactNode;
}

function ProfileField({ label, note, htmlFor, children }: ProfileFieldProps) {
  return <div className={fieldGrid}>
    {htmlFor ? <label className={fieldLabel} htmlFor={htmlFor}>{label}</label> : <div className={fieldLabel}>{label}</div>}
    <div>{children}{note ? <p className={fieldHint}>{note}</p> : null}</div>
  </div>;
}

interface ProfileTagsProps {
  label: string;
  value?: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  note?: string;
}

function ProfileTags({ label, value = [], onChange, placeholder, note }: ProfileTagsProps) {
  const [input, setInput] = useState('');
  const inputId = `profile-tags-${label}`;
  const commit = () => {
    const next = [...value];
    for (const part of toList(input)) if (!next.some((item) => item.toLowerCase() === part.toLowerCase())) next.push(part);
    if (next.length !== value.length) onChange(next);
    setInput('');
  };
  return <ProfileField label={label} note={note} htmlFor={inputId}>
    <div className={tagBox}>
      {value.map((item, index) => <span className={tagChip} key={`${item}-${index}`}>{item}<button type="button" className="size-[18px] cursor-pointer bg-transparent p-0 leading-none text-ink-2" aria-label={`删除 ${item}`} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}
      <input id={inputId} className={tagInput} aria-label={label} placeholder={value.length ? '' : (placeholder || '回车添加')} value={input} onChange={(event) => setInput(event.target.value)} onBlur={commit} onKeyDown={(event) => {
        if (['Enter', ',', '，'].includes(event.key)) { event.preventDefault(); commit(); }
        else if (event.key === 'Backspace' && !input && value.length) onChange(value.slice(0, -1));
      }} />
    </div>
  </ProfileField>;
}

interface DraftPreviewProps {
  draft: Profile;
  onApply: (replace: boolean) => void;
  onDiscard: () => void;
}

function DraftPreview({ draft, onApply, onDiscard }: DraftPreviewProps) {
  const rows = DRAFT_ROWS.map(([label, read]) => [label, read(draft)] as const).filter(([, value]) => !!(value && value.length));
  return <Dialog open onOpenChange={(open: boolean) => { if (!open) onDiscard(); }}>
    <DialogContent className="flex max-h-[min(760px,calc(100dvh_-_32px))] w-[min(720px,calc(100%_-_32px))] max-w-none flex-col gap-0 bg-surface p-6 text-ink-1 sm:max-w-none" showCloseButton={false}>
      <div>
        <DialogTitle>画像草稿</DialogTitle>
        <DialogDescription className="mt-2 text-ink-2">请核对抽取结果，确认后写入画像。</DialogDescription>
      </div>
      <div className="my-5 min-h-0 overflow-y-auto overscroll-contain">
        {rows.length ? <dl>{rows.map(([label, value]) => <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 border-t border-line py-3 text-section leading-[1.65]" key={label}><dt className="font-medium text-ink-2">{label}</dt><dd className="m-0 whitespace-pre-wrap wrap-anywhere">{Array.isArray(value) ? value.join('、') : value}</dd></div>)}</dl> : <p>没有识别到画像内容。</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={cn(button({ variant: 'primary' }), draftButton)} onClick={() => onApply(false)}>合并到画像</button>
        <button type="button" className={cn(button(), draftButton)} onClick={() => onApply(true)}>替换现有画像</button>
        <button type="button" className={cn(button({ variant: 'ghost' }), draftButton)} onClick={onDiscard}>放弃</button>
      </div>
    </DialogContent>
  </Dialog>;
}
