import React, { useEffect, useRef, useState } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { commitTags, filterSettingsPatch, parseSalaryMinK, removeLastTag } from './filterForm.js';
import './filters.css';

function TagEditor({ label, value = [], onChange, tone, hint }) {
  const [input, setInput] = useState('');
  const commit = () => {
    const next = commitTags(value, input);
    if (next !== value) onChange(next);
    setInput('');
  };
  return <div className="filter-field">
    <span className="filter-label">{label}</span>
    <div>
      <div className="filter-tags">
        {value.map((item, index) => <span key={`${item}-${index}`} className={tone === 'risk' ? 'filter-chip is-risk' : 'filter-chip'}>
          {item}
          <button type="button" className="filter-chip-x" aria-label={`删除 ${item}`} onClick={() => onChange(value.filter((_, n) => n !== index))}>×</button>
        </span>)}
        <input
          aria-label={label}
          className="filter-tags-input"
          placeholder={value.length ? '' : '回车添加'}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (['Enter', ',', '，'].includes(event.key)) {
              event.preventDefault();
              commit();
            } else if (event.key === 'Backspace' && !input && value.length) {
              onChange(removeLastTag(value, input));
            }
          }}
        />
      </div>
      {hint && <p className="filter-hint">{hint}</p>}
    </div>
  </div>;
}

function PreferenceFold({ openOnMount, children }) {
  const ref = useRef(null);
  useEffect(() => {
    // 只在进入页面时展开已有偏好，避免之后的保存把用户收起的折叠区重新打开。
    if (ref.current && openOnMount) ref.current.open = true;
  }, []);
  return <details ref={ref} className="filter-fold">
    <summary>经验与学历</summary>
    {children}
  </details>;
}

export default function FiltersTab({ settings, updateSettings }) {
  const filters = settings.filters;
  const update = (partial) => updateSettings(filterSettingsPatch(partial));
  const hasPreference = Boolean(filters.experience?.length || filters.degrees?.length);
  return <TabsContent value="filters" className="filter-page">
    <section className="filter-group">
      <label className="filter-switch-row">
        <span>
          <span className="filter-switch-label">启用本地筛选</span>
          <span className="filter-hint">关闭时列表显示全部岗位，只标注风险词</span>
        </span>
        <input
          className="filter-switch"
          type="checkbox"
          role="switch"
          checked={!!filters.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
      </label>
    </section>
    <section className="filter-group">
      <h2>关键词</h2>
      <div className="filter-fields">
        <TagEditor label="包含任一" value={filters.keywordsInclude || []} onChange={(value) => update({ keywordsInclude: value })} />
        <TagEditor label="排除关键词" hint="命中的岗位不显示" value={filters.keywordsExclude || []} onChange={(value) => update({ keywordsExclude: value })} />
        <TagEditor label="风险词" tone="risk" hint="只在岗位上标注提醒，筛选关闭时也生效" value={filters.riskKeywords || []} onChange={(value) => update({ riskKeywords: value })} />
      </div>
    </section>
    <section className="filter-group">
      <h2>公司与城市</h2>
      <div className="filter-fields">
        <TagEditor label="屏蔽公司" value={filters.excludeCompanies || []} onChange={(value) => update({ excludeCompanies: value })} />
        <TagEditor label="只看这些城市" hint="其他城市的岗位不显示" value={filters.cities || []} onChange={(value) => update({ cities: value })} />
      </div>
    </section>
    <section className="filter-group">
      <h2>薪资与要求</h2>
      <div className="filter-fields">
        <div className="filter-field">
          <label className="filter-label" htmlFor="filter-salary-min">月薪下限</label>
          <div>
            <div className="filter-salary">
              <input
                id="filter-salary-min"
                className="filter-input is-short"
                type="number"
                inputMode="decimal"
                aria-describedby="filter-salary-min-hint"
                value={filters.salaryMinK ?? ''}
                onChange={(event) => update({ salaryMinK: parseSalaryMinK(event.target.value) })}
              />
              <span className="filter-unit">k/月</span>
            </div>
            <p id="filter-salary-min-hint" className="filter-hint">岗位最高薪资低于这个数就不显示</p>
          </div>
        </div>
        <PreferenceFold openOnMount={hasPreference}>
          <p className="filter-hint">只记录为不符合的原因，不会隐藏岗位</p>
          <div className="filter-fields">
            <TagEditor label="经验偏好" value={filters.experience || []} onChange={(value) => update({ experience: value })} />
            <TagEditor label="学历偏好" value={filters.degrees || []} onChange={(value) => update({ degrees: value })} />
          </div>
        </PreferenceFold>
      </div>
    </section>
  </TabsContent>;
}
