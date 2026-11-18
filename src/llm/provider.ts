// ProviderAdapter: direct, browser-compatible BYOK HTTPS. No proxy is ever introduced silently (SPECS §6).

export type ProviderErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'refusal'
  | 'bad_request'
  | 'server'
  | 'truncated'
  | 'no_key'
  | 'invalid_output';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  effort: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  readonly kind: string;
  complete(request: CompletionRequest): Promise<string>;
}

/** Never let a key reach logs, records or UI error text. */
export function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join('[redacted]') : text;
}

/** Extracts the first top-level JSON object from model text (tolerates code fences and preambles). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new ProviderError('invalid_output', 'No JSON object in model output');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        break;
      }
    }
  }
  throw new ProviderError('invalid_output', 'Malformed JSON in model output');
}
