import React, { useEffect, useRef, useState } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { MODE, MSG, STORAGE_KEYS } from '../../common/constants.js';
import { send } from '../../extension/messages.js';
import UpdatePanel from './UpdatePanel.js';
import { summarizeJobs } from './jobStats.js';
import type { JobStats } from './jobStats.js';
import type { Job, PrivacySettings, Settings } from '../../common/types.js';
import type { Report, RequestConfirm, SettingsPatch, UpdateSettings } from './types.js';
import { button, choiceCard, choiceDot, groupTitle, hint, rowTitle, switchInput } from './recipes.js';

const MODE_OPTIONS: ReadonlyArray<readonly [Settings['mode'], string]> = [
  [MODE.auto, '跟随当前网站'],
  [MODE.boss, '只用 BOSS 直聘'],
];

type CaptureKey = 'autoCapture' | 'autoScore' | 'showBadge' | 'dedupe';

const CAPTURE_ROWS: ReadonlyArray<readonly [CaptureKey, string, string]> = [
  ['autoCapture', '自动收录岗位', ''],
  ['autoScore', '自动 AI 分析', '每个新岗位消耗一次接口调用。'],
  ['showBadge', '显示收录角标', '显示在招聘网站页面右下角。'],
  ['dedupe', '合并重复岗位', ''],
];

const PRIVACY_ROWS: ReadonlyArray<readonly [keyof PrivacySettings, string, string]> = [
  ['redactPII', '发送前脱敏', '不能保证移除所有个人信息'],
  ['sendCompanyName', '发送岗位公司名', ''],
  ['confirmBeforeSend', '发送招呼语前确认', ''],
];

interface SwitchRowProps {
  label: string;
  hint?: string;
  checked?: boolean;
  onChange: (checked: boolean) => void;
}

/** 分组：组与组之间一条分隔线，第一组贴顶。 */
const group = 'mt-7 mb-[30px] border-t border-line pt-5 first:mt-0 first:border-t-0 first:pt-0';

/** 「标题 + 说明」在左、操作在右的一行；窄屏改为上下排列。 */
const actionLine = 'flex flex-col items-start gap-4 border-t border-line py-3.5 wide:flex-row wide:items-center wide:justify-between';

function SwitchRow({ label, hint: note, checked, onChange }: SwitchRowProps) {
  return <label className="flex cursor-pointer items-center justify-between gap-4 border-b border-line py-[11px] last:border-b-0">
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className={rowTitle}>{label}</span>
      {note ? <span className={hint}>{note}</span> : null}
    </span>
    <input type="checkbox" role="switch" className={switchInput} aria-label={label} checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
  </label>;
}

export interface GeneralTabProps {
  settings: Settings;
  updateSettings: UpdateSettings;
  exportData: (format: string) => void;
  setConfirm: RequestConfirm;
  report: Report;
  updateCheckToken?: number;
}

export default function GeneralTab({ settings, updateSettings, exportData, setConfirm, report, updateCheckToken = 0 }: GeneralTabProps) {
  const [stats, setStats] = useState<JobStats | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const jobs = await send<Job[]>(MSG.JOB_LIST_REQUEST);
        if (!cancelled) setStats(summarizeJobs(jobs));
      } catch (e) {
        if (!cancelled) report(e instanceof Error ? e.message : '岗位库读取失败', true);
      }
    };
    reloadRef.current = load;
    load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
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

  return <TabsContent value="general">
    <section className={group}>
      <h2 id="gen-mode" className={groupTitle}>运行平台</h2>
      <div className="grid grid-cols-1 gap-2.5 wide:grid-cols-3" role="radiogroup" aria-labelledby="gen-mode">
        {MODE_OPTIONS.map(([value, label]) => <label key={value} className={`${choiceCard} min-h-12 px-[13px] py-3`}>
          <input type="radio" className="sr-only" name="settings-mode" value={value} checked={settings.mode === value} onChange={() => updateSettings({ mode: value })} />
          <span className={choiceDot} aria-hidden="true" />
          <span>{label}</span>
        </label>)}
      </div>
    </section>

    <section className={group}>
      <h2 className={groupTitle}>收录与分析</h2>
      <div className="flex flex-col">
        {CAPTURE_ROWS.map(([key, label, hint]) => <SwitchRow key={key} label={label} hint={hint} checked={settings[key]} onChange={(v) => updateSettings({ [key]: v } as SettingsPatch)} />)}
      </div>
      <div className="grid items-start gap-[7px] border-t border-line py-[11px] wide:grid-cols-[132px_minmax(0,1fr)] wide:gap-[18px]">
        <label htmlFor="gen-max-jobs" className="block text-control leading-normal font-medium text-ink-2 wide:pt-[7px]">岗位库上限</label>
        <div className="flex min-w-0 flex-col items-start gap-[7px] wide:flex-row wide:items-center wide:gap-3">
          <input id="gen-max-jobs" className="h-[34px] w-[88px] rounded-lg border border-line-strong bg-field px-2.5 text-body text-ink-1 focus:border-brand focus:shadow-focus focus:outline-none" type="number" inputMode="numeric" aria-describedby="gen-max-jobs-hint" value={settings.maxJobs} onChange={(e) => updateSettings({ maxJobs: Number(e.target.value) || 800 })} />
          <p id="gen-max-jobs-hint" className={`${hint} min-w-0`}>超出后先淘汰最早收录的，收藏的岗位不会被淘汰</p>
        </div>
      </div>
    </section>

    <section className={group}>
      <h2 className={groupTitle}>隐私</h2>
      <div className="flex flex-col">
        {PRIVACY_ROWS.map(([key, label, hint]) => <SwitchRow key={key} label={label} hint={hint} checked={settings.privacy[key]} onChange={(v) => updateSettings({ privacy: { [key]: v } as Partial<PrivacySettings> })} />)}
      </div>
    </section>

    <section className={group}>
      <h2 className={groupTitle}>岗位数据</h2>
      <p className="text-control leading-[1.65] text-ink-2" role="status">{countText}</p>
      <div className={actionLine}>
        <div>
          <div className={rowTitle}>导出岗位</div>
          <p className={hint}>只有 JSON 可以用来恢复</p>
        </div>
        <div className="flex flex-none flex-wrap gap-2">
          <button type="button" className={button()} onClick={() => exportData('json')}>JSON</button>
          <button type="button" className={button()} onClick={() => exportData('csv')}>CSV</button>
          <button type="button" className={button()} onClick={() => exportData('capture-log')}>补抓日志</button>
        </div>
      </div>
      <div className={actionLine}>
        <div>
          <div className={rowTitle}>清空岗位库</div>
          <p className={hint}>建议先导出 JSON</p>
        </div>
        <button type="button" className={button({ variant: 'danger' })} onClick={() => setConfirm({
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
    <div className="mt-2">
      <UpdatePanel onConfirm={setConfirm} updateChannel={settings.updateChannel} onUpdateChannel={(updateChannel) => updateSettings({ updateChannel })} checkToken={updateCheckToken} />
    </div>
  </TabsContent>;
}
