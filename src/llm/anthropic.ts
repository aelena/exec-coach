import { ProviderError, redact, type CompletionRequest, type ProviderAdapter } from './provider';

// Models whose safety classifiers can decline a request and that support server-side refusal fallback.
const FALLBACK_MODELS = /^claude-(fable-5-[12]|opus-5(-5)?|sonnet-5-5)$/;
// Older models reject the effort parameter.
const NO_EFFORT_MODELS = /^claude-(3|haiku-4|sonnet-4-[0-5]|opus-4-[01])/;

interface MessageResponse {
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
}

/**
 * Anthropic Messages API called straight from the browser with the user's own key.
 * The SDK requires an explicit opt-in for browser use because the key is visible to this device;
 * the app discloses that limitation in onboarding and settings.
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly kind = 'anthropic';
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl?: string,
  ) {}

  async complete(request: CompletionRequest): Promise<string> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({
      apiKey: this.apiKey,
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
      ...(this.baseUrl ? { baseURL: this.baseUrl } : {}),
    });
    const params: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages,
      ...(NO_EFFORT_MODELS.test(request.model) ? {} : { output_config: { effort: request.effort } }),
      ...(FALLBACK_MODELS.test(request.model)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
        : {}),
    };
    try {
      const create = client.beta.messages.create.bind(client.beta.messages) as unknown as (
        body: Record<string, unknown>,
        options: { signal?: AbortSignal },
      ) => Promise<MessageResponse>;
      const response = await create(params, { signal: request.signal });
      if (response.stop_reason === 'refusal') {
        throw new ProviderError('refusal', 'The model declined this request.');
      }
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
      if (response.stop_reason === 'max_tokens' && text.trim() === '') {
        throw new ProviderError('truncated', 'The response was cut off before any text was produced.', true);
      }
      return text;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if ((error as Error)?.name === 'AbortError' || error instanceof Anthropic.APIUserAbortError) throw error;
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new ProviderError('auth', 'The provider rejected the API key.');
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new ProviderError('rate_limit', 'Rate limited by the provider.', true);
      }
      if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
        throw new ProviderError('bad_request', redact(error.message, this.apiKey));
      }
      if (error instanceof Anthropic.APIConnectionError) {
        throw new ProviderError('network', 'Could not reach the provider (network or CORS).', true);
      }
      if (error instanceof Anthropic.APIError) {
        throw new ProviderError('server', redact(error.message, this.apiKey), true);
      }
      throw new ProviderError('network', redact(String((error as Error)?.message ?? error), this.apiKey), true);
    }
  }
}
