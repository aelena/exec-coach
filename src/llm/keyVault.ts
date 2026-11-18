import type { ProviderKind } from '../domain/types';

// API keys live in volatile memory by default, one per provider. Persisting one is an explicit,
// warned opt-in and uses a dedicated store that export/backup code never reads (SPECS §6).

const keys = new Map<ProviderKind, string>();

export const keyVault = {
  get(kind: ProviderKind): string {
    return keys.get(kind) ?? '';
  },
  set(kind: ProviderKind, key: string): void {
    const trimmed = key.trim();
    if (trimmed) keys.set(kind, trimmed);
    else keys.delete(kind);
  },
  clear(kind?: ProviderKind): void {
    if (kind) keys.delete(kind);
    else keys.clear();
  },
  has(kind: ProviderKind): boolean {
    return keys.has(kind);
  },
};
