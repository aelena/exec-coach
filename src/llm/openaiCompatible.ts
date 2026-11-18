import { ProviderError, redact, type CompletionRequest, type ProviderAdapter } from './provider';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
}

/**
 * Generic Chat Completions adapter for OpenAI-compatible endpoints (including local servers).
 * Whether a given endpoint accepts direct browser calls depends on its CORS policy; the connection
 * check in Settings reports the real outcome instead of assuming support.
 */
export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly kind = 'openai';
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async complete(request: CompletionRequest): Promise<string> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: request.model,
          messages: [{ role: 'system', content: request.system }, ...request.messages],
        }),
        signal: request.signal,
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      throw new ProviderError('network', 'Could not reach the provider (network or CORS).', true);
    }
    if (!response.ok) {
      const detail = redact((await response.text().catch(() => '')).slice(0, 300), this.apiKey);
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError('auth', 'The provider rejected the API key.');
      }
      if (response.status === 429) throw new ProviderError('rate_limit', 'Rate limited by the provider.', true);
      if (response.status >= 500) throw new ProviderError('server', `Provider error ${response.status}`, true);
      throw new ProviderError('bad_request', `Provider error ${response.status}: ${detail}`);
    }
    const data = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
    const message = data?.choices?.[0]?.message;
    if (message?.refusal) throw new ProviderError('refusal', 'The model declined this request.');
    if (typeof message?.content !== 'string') {
      throw new ProviderError('invalid_output', 'Unexpected provider response shape.');
    }
    return message.content;
  }
}
