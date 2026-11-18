import { ProviderError, redact, type CompletionRequest, type ProviderAdapter } from './provider';

export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GenerateContentResponse {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  promptFeedback?: { blockReason?: string };
}

/**
 * Google Gemini `generateContent` REST API, called directly from the browser with the user's key.
 * The key travels in the `x-goog-api-key` header, never in the URL (SPECS §6).
 */
export class GeminiAdapter implements ProviderAdapter {
  readonly kind = 'gemini';
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = GEMINI_DEFAULT_BASE_URL,
  ) {}

  async complete(request: CompletionRequest): Promise<string> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(request.model)}:generateContent`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: request.messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
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
      // Gemini reports an invalid key as 400 API_KEY_INVALID.
      if (/API_KEY_INVALID|API key not valid/i.test(detail)) {
        throw new ProviderError('auth', 'The provider rejected the API key.');
      }
      throw new ProviderError('bad_request', `Provider error ${response.status}: ${detail}`);
    }
    const data = (await response.json().catch(() => null)) as GenerateContentResponse | null;
    if (data?.promptFeedback?.blockReason) throw new ProviderError('refusal', 'The model declined this request.');
    const candidate = data?.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((part) => !part.thought)
      .map((part) => part.text ?? '')
      .join('');
    if (!text.trim()) {
      if (candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
        throw new ProviderError('refusal', 'The model declined this request.');
      }
      throw new ProviderError('invalid_output', 'The provider returned no text.', true);
    }
    return text;
  }
}
