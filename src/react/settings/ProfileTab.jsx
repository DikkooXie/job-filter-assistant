import React, { useRef, useState } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { toList } from '../../ui/ui-common.js';
import './profile.css';

const IMPORT_MODES = [
  { id: 'resume', label: '简历文件' },
  { id: 'paste', label: '粘贴文本' },
  { id: 'json', label: '画像 JSON' },
];

const DRAFT_ROWS = [
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
  ['规避关键词', (d) => d.preference.avoidKeywords],
  ['一票否决', (d) => d.preference.dealbreakers],
  ['给 AI 的说明', (d) => d.preference.notes],
];

export default function ProfileTab({ profile, draft, report, onEdit, onImportFiles, onExtractText, onApplyDraft, onDiscardDraft, onClear }) {
  const [mode, setMode] = useState('resume');
  const [paste, setPaste] = useState('');
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);
  const dragDepth = useRef(0);
  const valueOf = (group, key) => (group ? profile[group][key] : profile[key]);
  const editText = (group, key, type = 'text') => (event) => {
    const raw = event.target.value;
    onEdit(group, key, type === 'number' ? (raw === '' ? null : Number(raw)) : raw);
  };
  const takeFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length) onImportFiles(files, mode);
  };

  return <TabsContent value="profile" className="profile-page">
    <section className="profile-group">
      <h2>导入材料</h2>
      <p className="group-note">抽取时文本会发给当前启用的 AI，确认后才写入画像。</p>
      <div className="profile-fields">
        <div className="segment" role="radiogroup" aria-label="导入方式">
          {IMPORT_MODES.map((item) => <button key={item.id} type="button" role="radio" aria-checked={mode === item.id} onClick={() => setMode(item.id)}>{item.label}</button>)}
        </div>
        {mode === 'paste' ? <div className="paste-box">
          <textarea className="area-input" aria-label="简历文本" placeholder="在此粘贴简历文本" value={paste} onChange={(event) => setPaste(event.target.value)} />
          <button type="button" className="s-btn s-btn-primary" onClick={() => {
            const text = paste.trim();
            if (!text) report('请先粘贴简历文本', true);
            else onExtractText(text);
          }}>抽取画像</button>
        </div> : <div
          className={over ? 'dropzone is-over' : 'dropzone'}
          onDragEnter={(event) => { event.preventDefault(); dragDepth.current += 1; setOver(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setOver(false); }}
          onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setOver(false); takeFiles(event.dataTransfer.files); }}
        >
          <input
            ref={fileRef}
            className="file-input"
            tabIndex={-1}
            type="file"
            aria-label={mode === 'json' ? '选择画像 JSON' : '选择简历文件'}
            accept={mode === 'json' ? '.json,application/json' : '.pdf,.docx,.doc,.txt,.md,.markdown'}
            multiple={mode !== 'json'}
            onChange={(event) => { takeFiles(event.target.files); event.target.value = ''; }}
          />
          <button type="button" className="s-btn s-btn-outline" onClick={() => fileRef.current?.click()}>选择文件</button>
          <p className="drop-hint">{mode === 'json' ? '选择或拖入一个画像 JSON' : '选择或拖入 PDF、DOCX；MD / TXT 可一次多选'}</p>
        </div>}
        {draft && <DraftPreview draft={draft} onApply={onApplyDraft} onDiscard={onDiscardDraft} />}
      </div>
    </section>

    <section className="profile-group">
      <h2>求职目标</h2>
      <div className="profile-fields">
        <ProfileTags label="目标岗位" value={profile.target.jobTitles} placeholder="回车添加，如 前端工程师" onChange={(next) => onEdit('target', 'jobTitles', next)} />
        <ProfileTags label="目标城市" value={profile.target.cities} placeholder="回车添加，如 广州" note="符合的岗位匹配分更高" onChange={(next) => onEdit('target', 'cities', next)} />
        <ProfileField label="期望月薪" note="只用于匹配打分，不会写进招呼语">
          <div className="salary-row">
            <input className="num-input" type="number" aria-label="期望月薪下限" placeholder="下限" value={profile.target.salaryMinK ?? ''} onChange={editText('target', 'salaryMinK', 'number')} />
            <span aria-hidden="true">—</span>
            <input className="num-input" type="number" aria-label="期望月薪上限" placeholder="上限" value={profile.target.salaryMaxK ?? ''} onChange={editText('target', 'salaryMaxK', 'number')} />
            <span className="salary-unit">k/月</span>
          </div>
        </ProfileField>
        <ProfileTags label="目标行业" value={profile.target.industries} placeholder="回车添加，如 互联网" onChange={(next) => onEdit('target', 'industries', next)} />
        <ProfileTags label="公司规模" value={profile.target.companySizes} placeholder="回车添加，如 100-499人" onChange={(next) => onEdit('target', 'companySizes', next)} />
        <ProfileTags label="办公方式" value={profile.target.workModes} placeholder="回车添加，如 远程" onChange={(next) => onEdit('target', 'workModes', next)} />
      </div>
    </section>

    <section className="profile-group">
      <h2>个人基础</h2>
      <div className="profile-fields">
        <ProfileField label="最高学历" htmlFor="profile-education">
          <input id="profile-education" className="text-input" placeholder="如 本科" value={valueOf('basics', 'education') || ''} onChange={editText('basics', 'education')} />
        </ProfileField>
        <ProfileField label="当前或最近职位" htmlFor="profile-current-title">
          <input id="profile-current-title" className="text-input" placeholder="如 高级前端" value={valueOf('basics', 'currentTitle') || ''} onChange={editText('basics', 'currentTitle')} />
        </ProfileField>
        <ProfileField label="姓名" htmlFor="profile-name">
          <input id="profile-name" className="text-input" placeholder="留空即不填" value={valueOf('basics', 'name') || ''} onChange={editText('basics', 'name')} />
        </ProfileField>
        <ProfileField label="工作年限" htmlFor="profile-years">
          <input id="profile-years" className="num-input" type="number" placeholder="如 3" value={valueOf('basics', 'yearsOfExperience') ?? ''} onChange={editText('basics', 'yearsOfExperience', 'number')} />
        </ProfileField>
      </div>
    </section>

    <section className="profile-group">
      <h2>能力与经历</h2>
      <div className="profile-fields">
        <ProfileTags label="专业技能" value={profile.capabilities.skills} placeholder="回车添加，如 React" onChange={(next) => onEdit('capabilities', 'skills', next)} />
        <ProfileTags label="优势亮点" value={profile.capabilities.strengths} placeholder="回车添加" onChange={(next) => onEdit('capabilities', 'strengths', next)} />
        <ProfileTags label="行业经验" value={profile.capabilities.industryExperience} placeholder="回车添加，如 电商" onChange={(next) => onEdit('capabilities', 'industryExperience', next)} />
        <ProfileField label="工作经历概述" htmlFor="profile-work">
          <textarea id="profile-work" className="area-input" placeholder="一段话概述工作经历" value={valueOf(null, 'workSummary') || ''} onChange={editText(null, 'workSummary')} />
        </ProfileField>
        <ProfileField label="项目经历概述" htmlFor="profile-project" note="AI 撰写招呼语时只会引用这里写到的事实">
          <textarea id="profile-project" className="area-input" placeholder="代表性项目" value={valueOf(null, 'projectSummary') || ''} onChange={editText(null, 'projectSummary')} />
        </ProfileField>
        <ProfileTags label="核心成就" value={profile.highlights} placeholder="回车添加" onChange={(next) => onEdit(null, 'highlights', next)} />
      </div>
    </section>

    <section className="profile-group">
      <h2>偏好与禁区</h2>
      <div className="profile-fields">
        <ProfileTags label="规避关键词" value={profile.preference.avoidKeywords} placeholder="回车添加，如 外包" note="命中时降低匹配分，岗位仍会保留" onChange={(next) => onEdit('preference', 'avoidKeywords', next)} />
        <ProfileTags label="一票否决" value={profile.preference.dealbreakers} placeholder="回车添加" note="命中时 AI 判为不合适，岗位仍会保留" onChange={(next) => onEdit('preference', 'dealbreakers', next)} />
        <ProfileField label="给 AI 的说明" htmlFor="profile-notes">
          <textarea id="profile-notes" className="area-input" value={valueOf('preference', 'notes') || ''} onChange={editText('preference', 'notes')} />
        </ProfileField>
      </div>
    </section>

    <section className="profile-group">
      <div className="danger-row">
        <div>
          <h2>清除画像</h2>
          <p className="group-note">清空全部画像字段，并使已有匹配分缓存失效。不可撤销。</p>
        </div>
        <button type="button" className="s-btn s-btn-danger" onClick={onClear}>清除画像</button>
      </div>
    </section>
  </TabsContent>;
}

function ProfileField({ label, note, htmlFor, children }) {
  return <div className="profile-field">
    {htmlFor ? <label className="field-label" htmlFor={htmlFor}>{label}</label> : <div className="field-label">{label}</div>}
    <div className="field-control">{children}{note ? <p className="field-note">{note}</p> : null}</div>
  </div>;
}

function ProfileTags({ label, value = [], onChange, placeholder, note }) {
  const [input, setInput] = useState('');
  const inputId = `profile-tags-${label}`;
  const commit = () => {
    const next = [...value];
    for (const part of toList(input)) if (!next.some((item) => item.toLowerCase() === part.toLowerCase())) next.push(part);
    if (next.length !== value.length) onChange(next);
    setInput('');
  };
  return <ProfileField label={label} note={note} htmlFor={inputId}>
    <div className="chip-box">
      {value.map((item, index) => <span className="chip" key={`${item}-${index}`}>{item}<button type="button" aria-label={`删除 ${item}`} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}
      <input id={inputId} className="chip-input" aria-label={label} placeholder={value.length ? '' : (placeholder || '回车添加')} value={input} onChange={(event) => setInput(event.target.value)} onBlur={commit} onKeyDown={(event) => {
        if (['Enter', ',', '，'].includes(event.key)) { event.preventDefault(); commit(); }
        else if (event.key === 'Backspace' && !input && value.length) onChange(value.slice(0, -1));
      }} />
    </div>
  </ProfileField>;
}

function DraftPreview({ draft, onApply, onDiscard }) {
  const rows = DRAFT_ROWS.map(([label, read]) => [label, read(draft)]).filter(([, value]) => value && value.length);
  return <div className="draft-box">
    <h3>画像草稿</h3>
    <dl>{rows.map(([label, value]) => <div className="draft-line" key={label}><dt>{label}：</dt><dd>{Array.isArray(value) ? value.join('、') : value}</dd></div>)}</dl>
    <div className="draft-actions">
      <button type="button" className="s-btn s-btn-primary" onClick={() => onApply(false)}>合并到画像</button>
      <button type="button" className="s-btn s-btn-outline" onClick={() => onApply(true)}>替换现有画像</button>
      <button type="button" className="s-btn s-btn-ghost" onClick={onDiscard}>放弃</button>
    </div>
  </div>;
}
