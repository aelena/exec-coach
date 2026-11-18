import type { AppLocale } from '../domain/types';

// SpeechAdapter: browser speech synthesis and recognition behind feature detection (SPECS §4).
// Half-duplex by design: the app never listens while it speaks, and turn-taking is explicit.
// Raw audio is never stored; only the recognised text reaches the session record.
// Note: in several browsers speech recognition is performed by a third-party cloud service;
// the UI discloses this before the microphone is first used.

export interface SpeechCapabilities {
  tts: boolean;
  stt: boolean;
  wakeLock: boolean;
}

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => RecognitionLike) | null;
}

export function speechCapabilities(): SpeechCapabilities {
  return {
    tts: typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined',
    stt: recognitionCtor() !== null,
    wakeLock: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
  };
}

export type ListenError = 'not_supported' | 'permission' | 'no_speech' | 'network' | 'aborted' | 'unknown';

export interface ListenHandle {
  /** Stops listening and resolves with everything recognised so far. */
  stop(): void;
  cancel(): void;
}

export interface ListenCallbacks {
  onInterim(text: string): void;
  onFinal(text: string): void;
  onError(error: ListenError): void;
}

const ERROR_MAP: Record<string, ListenError> = {
  'not-allowed': 'permission',
  'service-not-allowed': 'permission',
  'no-speech': 'no_speech',
  network: 'network',
  aborted: 'aborted',
  'audio-capture': 'permission',
};

export class BrowserSpeech {
  private speaking = false;

  voices(locale: AppLocale): SpeechSynthesisVoice[] {
    if (!speechCapabilities().tts) return [];
    const prefix = locale.slice(0, 2).toLowerCase();
    return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(prefix));
  }

  /** Speaks text and resolves when finished, cancelled or unsupported. Never rejects. */
  speak(text: string, locale: AppLocale, options: { rate?: number; voiceURI?: string | null } = {}): Promise<void> {
    if (!speechCapabilities().tts || !text.trim()) return Promise.resolve();
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = locale;
      utterance.rate = options.rate ?? 1;
      const voices = this.voices(locale);
      const voice = voices.find((v) => v.voiceURI === options.voiceURI) ?? voices.find((v) => v.lang === locale) ?? voices[0];
      if (voice) utterance.voice = voice;
      // Some engines never fire `end`; a generous watchdog keeps the session from stalling.
      const watchdog = window.setTimeout(done, Math.min(120_000, 4000 + text.length * 110));
      const self = this;
      function done() {
        window.clearTimeout(watchdog);
        self.speaking = false;
        resolve();
      }
      utterance.onend = done;
      utterance.onerror = done;
      this.speaking = true;
      synth.speak(utterance);
    });
  }

  cancelSpeech(): void {
    if (speechCapabilities().tts) window.speechSynthesis.cancel();
    this.speaking = false;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  listen(locale: AppLocale, callbacks: ListenCallbacks): ListenHandle {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      callbacks.onError('not_supported');
      return { stop() {}, cancel() {} };
    }
    // Half-duplex: stop any speech output before opening the microphone.
    this.cancelSpeech();
    const recognition = new Ctor();
    recognition.lang = locale;
    recognition.continuous = true; // deliberate pauses must not end the turn
    recognition.interimResults = true;
    let finalText = '';
    let cancelled = false;
    let stopping = false;
    let failed = false;
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) finalText += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      callbacks.onInterim(`${finalText}${interim}`.trim());
    };
    recognition.onerror = (event) => {
      if (cancelled || event.error === 'aborted') return;
      // Silence alone is not an error while the trainee is thinking.
      if (event.error === 'no-speech' && !stopping) return;
      failed = true;
      callbacks.onError(ERROR_MAP[event.error] ?? 'unknown');
    };
    recognition.onend = () => {
      if (cancelled || failed) return;
      if (!stopping) {
        // The engine timed out on its own; keep the microphone open until the trainee ends the turn.
        try {
          recognition.start();
          return;
        } catch {
          /* fall through and deliver what we have */
        }
      }
      callbacks.onFinal(finalText.trim());
    };
    try {
      recognition.start();
    } catch {
      callbacks.onError('unknown');
    }
    return {
      stop() {
        stopping = true;
        recognition.stop();
      },
      cancel() {
        cancelled = true;
        recognition.abort();
      },
    };
  }
}

export const speech = new BrowserSpeech();

/** Localised voice commands (SPECS §17). Matched only against a whole utterance, never inside a sentence. */
const COMMANDS: Record<AppLocale, Record<'pause' | 'resume' | 'end', string[]>> = {
  en: {
    pause: ['pause', 'pause session', 'pause the session'],
    resume: ['resume', 'continue', 'resume session'],
    end: ['end session', 'end the session', 'finish session', 'stop session'],
  },
  'es-ES': {
    pause: ['pausa', 'pausar', 'pausar sesion', 'pausa la sesion'],
    resume: ['continuar', 'reanudar', 'reanudar sesion', 'seguir'],
    end: ['terminar sesion', 'finalizar sesion', 'terminar la sesion', 'fin de la sesion'],
  },
};

export function matchVoiceCommand(text: string, locale: AppLocale): 'pause' | 'resume' | 'end' | null {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [command, phrases] of Object.entries(COMMANDS[locale]) as Array<['pause' | 'resume' | 'end', string[]]>) {
    if (phrases.includes(normalized)) return command;
  }
  return null;
}

/** Screen Wake Lock with feature detection and revocation handling. It does NOT keep audio alive in the background. */
export class WakeLockManager {
  private sentinel: { release(): Promise<void>; addEventListener(type: 'release', cb: () => void): void } | null = null;
  private wanted = false;
  private readonly onVisibility = () => {
    if (this.wanted && document.visibilityState === 'visible') void this.acquire();
  };

  private async acquire(): Promise<boolean> {
    try {
      const api = (navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<NonNullable<WakeLockManager['sentinel']>> } }).wakeLock;
      if (!api) return false;
      this.sentinel = await api.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
      return true;
    } catch {
      return false; // denied, low battery, or tab not visible
    }
  }

  async enable(): Promise<boolean> {
    if (!speechCapabilities().wakeLock) return false;
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    return this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    await this.sentinel?.release().catch(() => undefined);
    this.sentinel = null;
  }

  get active(): boolean {
    return this.sentinel !== null;
  }
}
