// 设置页各 Tab 共用的界面类型。只描述前端状态，不参与存储结构。
import type { JobFilters, PrivacySettings, Settings } from '../../common/types.js';

/** updateSettings 接受的补丁：filters / privacy 允许只传要改的字段。 */
export interface SettingsPatch extends Omit<Partial<Settings>, 'filters' | 'privacy'> {
  filters?: Partial<JobFilters>;
  privacy?: Partial<PrivacySettings>;
}

export type UpdateSettings = (patch: SettingsPatch) => void;

export type Report = (message: string | null, isError?: boolean) => void;

export interface Notification {
  message: string;
  error?: boolean;
}

export interface ConfirmRequest {
  title: string;
  body?: string;
  run: () => void | Promise<void>;
}

export type RequestConfirm = (request: ConfirmRequest) => void;

export type RunAction = (fn: () => Promise<void>) => Promise<void>;

export type WithBusy = (text: string, fn: () => Promise<void>) => Promise<void>;
