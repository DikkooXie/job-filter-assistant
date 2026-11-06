import React, { useEffect, useRef, useState } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { MODE, MSG, STORAGE_KEYS } from '../../common/constants.js';
import { send } from '../../ui/ui-common.js';
import UpdatePanel from '../UpdatePanel.jsx';
import { summarizeJobs } from './jobStats.js';
import './general.css';

const MODE_OPTIONS = [
  [MODE.auto, '跟随当前网站'],
  [MODE.boss, '只用 BOSS 直聘'],
];

const CAPTURE_ROWS = [
  ['autoCapture', '自动收录岗位', ''],
  ['autoScore', '自动 AI 分析', '每个新岗位消耗一次接口调用。'],
  ['showBadge', '显示收录角标', '显示在招聘网站页面右下角。'],
  ['dedupe', '合并重复岗位', ''],
];

const PRIVACY_ROWS = [
  ['redactPII', '发送前脱敏', '不能保证移除所有个人信息'],
  ['sendCompanyName', '发送岗位公司名', ''],
  ['confirmBeforeSend', '发送招呼语前确认', ''],
];

function SwitchRow({ label, hint, checked, onChange }) {
  return <label className="gen-switch">
    <span className="gen-switch-copy">
      <span className="gen-switch-title">{label}</span>
      {hint ? <span className="gen-hint">{hint}</span> : null}
    </span>
    <input type="checkbox" role="switch" aria-label={label} checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
  </label>;
}

export default function GeneralTab({ settings, updateSettings, exportData, setConfirm, report, updateCheckToken = 0 }) {
  const [stats, setStats] = useState(null);
  const reloadRef = useRef(async () => {});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const jobs = await send(MSG.JOB_LIST_REQUEST);
        if (!cancelled) setStats(summarizeJobs(jobs));
      } catch (e) {
        if (!cancelled) report(e.message || '岗位库读取失败', true);
      }
    };
    reloadRef.current = load;
    load();
    const onChanged = (changes, area) => {
      if (area === 'local' && changes[STORAGE_KEYS.jobs]) load();
    };
    const storageEvents = globalThis.chrome?.storage?.onChanged;
    storageEvents?.addListener?.(onChanged);
    return () => {
      cancelled = true;
      storageEvents?.removeListener?.(onChanged);
    };
  }, [report]);

  const countText = stats
    ? `已收录 ${stats.total} 个，其中收藏 ${stats.starred} 个，上限 ${settings.maxJobs} 个`
    : '正在读取岗位库…';

  return <TabsContent value="general" className="gen-page">
    <section className="gen-group is-first">
      <h2 id="gen-mode">运行平台</h2>
      <div className="gen-cards" role="radiogroup" aria-labelledby="gen-mode">
        {MODE_OPTIONS.map(([value, label]) => <label key={value} className="gen-card">
          <input type="radio" name="settings-mode" value={value} checked={settings.mode === value} onChange={() => updateSettings({ mode: value })} />
          <span className="gen-dot" aria-hidden="true" />
          <span>{label}</span>
        </label>)}
      </div>
    </section>

    <section className="gen-group">
      <h2>收录与分析</h2>
      <div className="gen-switches">
        {CAPTURE_ROWS.map(([key, label, hint]) => <SwitchRow key={key} label={label} hint={hint} checked={settings[key]} onChange={(v) => updateSettings({ [key]: v })} />)}
      </div>
      <div className="gen-field">
        <div className="gen-field-label">
          <label htmlFor="gen-max-jobs">岗位库上限</label>
        </div>
        <div className="gen-field-control">
          <input id="gen-max-jobs" className="gen-number" type="number" inputMode="numeric" aria-describedby="gen-max-jobs-hint" value={settings.maxJobs} onChange={(e) => updateSettings({ maxJobs: Number(e.target.value) || 800 })} />
          <p id="gen-max-jobs-hint" className="gen-hint">超出后先淘汰最早收录的，收藏的岗位不会被淘汰</p>
        </div>
      </div>
    </section>

    <section className="gen-group">
      <h2>隐私</h2>
      <div className="gen-switches">
        {PRIVACY_ROWS.map(([key, label, hint]) => <SwitchRow key={key} label={label} hint={hint} checked={settings.privacy[key]} onChange={(v) => updateSettings({ privacy: { [key]: v } })} />)}
      </div>
    </section>

    <section className="gen-group">
      <h2>岗位数据</h2>
      <p className="gen-note" role="status">{countText}</p>
      <div className="gen-line">
        <div>
          <div className="gen-line-title">导出岗位</div>
          <p className="gen-hint">只有 JSON 可以用来恢复</p>
        </div>
        <div className="gen-actions">
          <button type="button" className="gen-btn" onClick={() => exportData('json')}>JSON</button>
          <button type="button" className="gen-btn" onClick={() => exportData('csv')}>CSV</button>
          <button type="button" className="gen-btn" onClick={() => exportData('capture-log')}>补抓日志</button>
        </div>
      </div>
      <div className="gen-line">
        <div>
          <div className="gen-line-title">清空岗位库</div>
          <p className="gen-hint">建议先导出 JSON</p>
        </div>
        <button type="button" className="gen-btn gen-btn-danger" onClick={() => setConfirm({
          title: '清空岗位库？',
          body: '删除全部已收录岗位，不可撤销。建议先导出 JSON。',
          run: async () => {
            await send(MSG.JOB_CLEAR_REQUEST);
            await reloadRef.current();
            report('已清空');
          },
        })}>清空岗位库</button>
      </div>
    </section>

    {/* #7 负责「关于与更新」内部，这里只留页底挂载位。 */}
    <div className="gen-update-slot">
      <UpdatePanel onConfirm={setConfirm} updateChannel={settings.updateChannel} onUpdateChannel={(updateChannel) => updateSettings({ updateChannel })} checkToken={updateCheckToken} />
    </div>
  </TabsContent>;
}
