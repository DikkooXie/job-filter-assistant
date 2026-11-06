// 画像 + 当前模型的指纹。匹配缓存键和岗位上的画像戳共用这一份算法。
// 字段和 hash 与原先 background 里的私有实现一致；改字段或改 hash 会让已有缓存全部失效。
import type { AIProvider, Match, Profile } from './types.js';

// 与 settingsStore.getActiveProvider 同一规则：命中 activeProviderId，否则取列表第一项。
export function pickActiveProvider(
  providers: readonly AIProvider[] | null | undefined,
  activeProviderId: string,
): AIProvider | null {
  const list = Array.isArray(providers) ? providers : [];
  if (!list.length) return null;
  return list.find((provider) => provider && provider.id === activeProviderId) || list[0] || null;
}

export function profileFingerprint(
  profile: Profile | Partial<Profile> | null | undefined,
  provider: Pick<AIProvider, 'model'> | null | undefined,
): string {
  const source: Partial<Profile> = profile && typeof profile === 'object' ? profile : {};
  const model = provider && typeof provider === 'object' ? provider.model : undefined;
  const serialized = JSON.stringify({
    t: source.target,
    c: source.capabilities,
    b: source.basics,
    w: source.workSummary,
    pj: source.projectSummary,
    h: source.highlights,
    pr: source.preference,
    m: model,
  });
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    hash = (hash * 31 + serialized.charCodeAt(i)) | 0;
  }
  return String(hash >>> 0);
}

// 把当前指纹盖到匹配结果上。不改原对象，缺结果时原样返回。
export function withProfileFp<T extends Match>(match: T | null | undefined, fingerprint: unknown): T | null | undefined {
  if (!match || typeof match !== 'object') return match;
  return { ...match, profileFp: String(fingerprint ?? '') };
}
