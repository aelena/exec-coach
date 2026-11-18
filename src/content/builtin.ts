import type { RawContent } from './registry';

// Built-in bilingual packs are bundled at build time; user packs are imported at runtime (no rebuild).
const modules = import.meta.glob<string>(
  ['/voices/**/*.md', '/scenarios/**/*.md', '/coaches/**/*.md', '/profiles/**/*.md'],
  { query: '?raw', import: 'default', eager: true },
);

export const BUILTIN_CONTENT: RawContent[] = Object.entries(modules).map(([path, source]) => ({ path, source }));

const templates = import.meta.glob<string>('/templates/**/*.md', { query: '?raw', import: 'default', eager: true });

export function templateFor(kind: string, language: string): string {
  const dir = language === 'en' ? 'en' : 'es';
  return templates[`/templates/${dir}/${kind}.template.md`] ?? '';
}
