import type { ContentSnapshot, CustomContentRecord } from '../domain/types';
import { contentHash, validateContent, type ContentKind, type Issue, type ParsedDoc } from './markdown';

export interface RawContent {
  path: string;
  source: string;
  custom?: boolean;
}

export interface ResolvedDoc {
  doc: ParsedDoc;
  custom: boolean;
  /** Set when the requested language was unavailable and another variant was used. */
  fallbackFrom?: string;
}

export interface RegistryProblem {
  path: string;
  errors: Issue[];
}

/**
 * Resolves content by `id` + `language`, validating every file and reporting fallbacks explicitly
 * (SPECS §27). User-imported content overrides built-ins with the same id and language.
 */
export class ContentRegistry {
  private readonly docs = new Map<string, { doc: ParsedDoc; custom: boolean }>();
  readonly problems: RegistryProblem[] = [];

  constructor(files: RawContent[]) {
    for (const file of files) {
      const result = validateContent(file.source);
      if (!result.ok || !result.doc) {
        this.problems.push({ path: file.path, errors: result.errors });
        continue;
      }
      const key = ContentRegistry.key(result.doc.kind, result.doc.id, result.doc.language);
      const existing = this.docs.get(key);
      if (existing && existing.custom && !file.custom) continue;
      this.docs.set(key, { doc: result.doc, custom: Boolean(file.custom) });
    }
  }

  static key(kind: ContentKind, id: string, language: string): string {
    return `${kind}:${id}:${language}`;
  }

  static fromCustomRecords(builtin: RawContent[], custom: CustomContentRecord[]): ContentRegistry {
    return new ContentRegistry([
      ...builtin,
      ...custom.map((c) => ({ path: `custom/${c.key}`, source: c.source, custom: true })),
    ]);
  }

  resolve(kind: ContentKind, id: string, language: string): ResolvedDoc | undefined {
    const exact = this.docs.get(ContentRegistry.key(kind, id, language));
    if (exact) return { ...exact };
    for (const entry of this.docs.values()) {
      if (entry.doc.kind === kind && entry.doc.id === id) {
        return { ...entry, fallbackFrom: entry.doc.language };
      }
    }
    return undefined;
  }

  ids(kind: ContentKind): string[] {
    const ids = new Set<string>();
    for (const entry of this.docs.values()) if (entry.doc.kind === kind) ids.add(entry.doc.id);
    return [...ids].sort();
  }

  list(kind: ContentKind, language: string): ResolvedDoc[] {
    return this.ids(kind)
      .map((id) => this.resolve(kind, id, language))
      .filter((d): d is ResolvedDoc => d !== undefined);
  }

  languagesOf(kind: ContentKind, id: string): string[] {
    return [...this.docs.values()]
      .filter((e) => e.doc.kind === kind && e.doc.id === id)
      .map((e) => e.doc.language)
      .sort();
  }
}

export async function snapshotOf(resolved: ResolvedDoc): Promise<ContentSnapshot> {
  return {
    kind: resolved.doc.kind,
    id: resolved.doc.id,
    language: resolved.doc.language,
    version: resolved.doc.version,
    hash: await contentHash(resolved.doc.source),
    source: resolved.doc.source,
    ...(resolved.fallbackFrom ? { fallbackFrom: resolved.fallbackFrom } : {}),
  };
}

/** Rebuilds a parsed document from a frozen session snapshot, so replays never drift with edits. */
export function docFromSnapshot(snapshot: ContentSnapshot): ParsedDoc {
  const result = validateContent(snapshot.source, snapshot.kind);
  if (!result.doc) throw new Error(`Snapshot ${snapshot.kind}:${snapshot.id} is no longer valid`);
  return result.doc;
}
