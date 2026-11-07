import React, { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '../../lib/cn.js';
import { commitTags, filterSettingsPatch, parseSalaryMinK, removeLastTag } from './filterForm.js';
import type { Settings } from '../../common/types.js';
import type { UpdateSettings } from './types.js';
import { fieldGrid, fieldHint, fieldLabel, focusRing, groupTitle, hint, rowTitle, switchInput } from './recipes.js';

/** 分组：组与组之间一条分隔线，第一组贴顶。 */
const group = 'mt-[30px] border-t border-line pt-7 first:mt-0 first:border-t-0 first:pt-0';

/** 一组字段纵向排列。 */
const fields = 'flex flex-col gap-[11px]';

/** 标签输入框外框：看起来是一个输入框，里面排已添加的标签和真正的 input。 */
const tagBox = 'flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-field px-2 py-1.5 text-ink-1 focus-within:border-brand focus-within:shadow-focus';

const chip = 'inline-flex h-6 items-center rounded-md bg-well pr-0.5 pl-2 text-note leading-none text-ink-1';

/** 去掉数字输入框右侧的上下箭头。 */
const noSpinner = '[-moz-appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:[-webkit-appearance:none] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:[-webkit-appearance:none]';

interface TagEditorProps {
  label: string;
  value?: string[];
  onChange: (next: string[]) => void;
  tone?: 'risk';
  hint?: string;
}

function TagEditor({ label, value = [], onChange, tone, hint: note }: TagEditorProps) {
  const [input, setInput] = useState('');
  const commit = () => {
    const next = commitTags(value, input);
    if (next !== value) onChange(next);
    setInput('');
  };
  return <div className={fieldGrid}>
    <span className={fieldLabel}>{label}</span>
    <div>
      <div className={tagBox}>
        {value.map((item, index) => <span key={`${item}-${index}`} className={cn(chip, tone === 'risk' && 'bg-danger-soft text-danger')}>
          {item}
          <button type="button" className={cn('inline-grid size-[18px] cursor-pointer place-items-center rounded-sm bg-transparent text-[14px] leading-none text-inherit', focusRing)} aria-label={`删除 ${item}`} onClick={() => onChange(value.filter((_, n) => n !== index))}>×</button>
        </span>)}
        <input
          aria-label={label}
          className="h-6 min-w-[8em] flex-[1_1_8em] border-0 bg-transparent p-0 text-body text-ink-1 outline-none placeholder:text-ink-3"
          placeholder={value.length ? '' : '回车添加'}
          value={input}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setInput(event.target.value)}
          onBlur={commit}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (['Enter', ',', '，'].includes(event.key)) {
              event.preventDefault();
              commit();
            } else if (event.key === 'Backspace' && !input && value.length) {
              onChange(removeLastTag(value, input));
            }
          }}
        />
      </div>
      {note && <p className={fieldHint}>{note}</p>}
    </div>
  </div>;
}

interface PreferenceFoldProps {
  openOnMount: boolean;
  children: ReactNode;
}

function PreferenceFold({ openOnMount, children }: PreferenceFoldProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // 只在进入页面时展开已有偏好，避免之后的保存把用户收起的折叠区重新打开。
    if (ref.current && openOnMount) ref.current.open = true;
  }, []);
  return <details ref={ref} className="group mt-1 border-t border-dashed border-line-strong pt-3.5">
    <summary className={cn(summary, focusRing)}>经验与学历</summary>
    {children}
  </details>;
}

/** 折叠标题：去掉原生三角，用 ::before 画「›」，展开时转 90°。 */
const summary = [
  'flex w-fit cursor-pointer list-none items-center gap-1 text-note leading-normal text-ink-2 [&::-webkit-details-marker]:hidden group-open:mb-3',
  "before:inline-block before:w-[0.8em] before:origin-[45%_55%] before:content-['›'] group-open:before:rotate-90",
  'motion-safe:before:transition-transform motion-safe:before:duration-150 motion-safe:before:ease-[ease]',
].join(' ');

export interface FiltersTabProps {
  settings: Settings;
  updateSettings: UpdateSettings;
}

export default function FiltersTab({ settings, updateSettings }: FiltersTabProps) {
  const filters = settings.filters;
  const update = (partial: Record<string, unknown>) => updateSettings(filterSettingsPatch(partial));
  const hasPreference = Boolean(filters.experience?.length || filters.degrees?.length);
  return <TabsContent value="filters">
    <section className={group}>
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span>
          <span className={`${rowTitle} block`}>启用本地筛选</span>
          <span className={`${hint} mt-0.5 block`}>关闭时列表显示全部岗位，并标注命中的规则</span>
        </span>
        <input
          className={switchInput}
          type="checkbox"
          role="switch"
          checked={!!filters.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
      </label>
    </section>
    <section className={group}>
      <h2 className={groupTitle}>关键词</h2>
      <div className={fields}>
        <TagEditor label="包含任一" value={filters.keywordsInclude || []} onChange={(value) => update({ keywordsInclude: value })} />
        <TagEditor label="排除关键词" hint="命中的岗位不显示" value={filters.keywordsExclude || []} onChange={(value) => update({ keywordsExclude: value })} />
        <TagEditor label="风险词" tone="risk" hint="只在岗位上标注提醒，筛选关闭时也生效" value={filters.riskKeywords || []} onChange={(value) => update({ riskKeywords: value })} />
      </div>
    </section>
    <section className={group}>
      <h2 className={groupTitle}>公司与城市</h2>
      <div className={fields}>
        <TagEditor label="屏蔽公司" value={filters.excludeCompanies || []} onChange={(value) => update({ excludeCompanies: value })} />
        <TagEditor label="只看这些城市" hint="其他城市的岗位不显示" value={filters.cities || []} onChange={(value) => update({ cities: value })} />
      </div>
    </section>
    <section className={group}>
      <h2 className={groupTitle}>薪资与要求</h2>
      <div className={fields}>
        <div className={fieldGrid}>
          <label className={fieldLabel} htmlFor="filter-salary-min">月薪下限</label>
          <div>
            <div className="flex items-center gap-2">
              <input
                id="filter-salary-min"
                className={cn('h-[34px] w-[88px] rounded-lg border border-line-strong bg-field px-2.5 text-body text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand focus:shadow-focus', noSpinner)}
                type="number"
                inputMode="decimal"
                aria-describedby="filter-salary-min-hint"
                value={filters.salaryMinK ?? ''}
                onChange={(event) => update({ salaryMinK: parseSalaryMinK(event.target.value) })}
              />
              <span className={hint}>k/月</span>
            </div>
            <p id="filter-salary-min-hint" className={fieldHint}>岗位最高薪资低于这个数就不显示</p>
          </div>
        </div>
        <PreferenceFold openOnMount={hasPreference}>
          <p className={`${hint} mb-[11px]`}>只记录为不符合的原因，不会隐藏岗位</p>
          <div className={fields}>
            <TagEditor label="经验偏好" value={filters.experience || []} onChange={(value) => update({ experience: value })} />
            <TagEditor label="学历偏好" value={filters.degrees || []} onChange={(value) => update({ degrees: value })} />
          </div>
        </PreferenceFold>
      </div>
    </section>
  </TabsContent>;
}
