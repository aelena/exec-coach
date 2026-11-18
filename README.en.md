# Executive Reflexes

**A deliberate-practice gym for executive communication.** Short spoken katas against simulated executives, an independent coach, and a causal debrief of what happened and why. An installable, voice-first, local-first, bring-your-own-key PWA with no backend.

[Español](README.md)

## Why this exists

This project grew out of a Socratic conversation about Albert Bandura's self-efficacy: you come to believe you can do something by doing it, repeatedly, under realistic conditions, and seeing yourself succeed. The skill in question is what we call **executive reflexes**: noticing, *while the meeting is still happening*, the unvalidated premise, the business contradiction, the incentive nobody mentions, the political risk, the elephant in the room — and then intervening firmly without needlessly threatening anyone's standing.

The first trainee is an experienced CTO and technical advisor. The technical judgment is already there. What needs practice is the spontaneous part: brevity, strategic breadth, political awareness, and saying a hard thing in a way that can be heard.

> **The goal is not compliance or more politeness. It is influence without loss of rigour.**

### What the original exercises taught

The scenarios shipped with the app come from real practice sessions, and each carries a lesson that shaped the design:

- **A "complete" AI assistant in six weeks**, with no evaluation set and no acceptance criteria. The move is to separate the commercial commitment from the technical conditions for meeting it: refuse the unsupported guarantee, offer a limited delivery that can be verified, and respect what the contract actually says.
- **Automating 200,000 hours** does not mean saving that money. Released capacity, cash savings, avoided hiring and redeployed capacity are four different things, and only some of them reach the accounts.
- **An external advisor does not have to challenge the CEO's strategy in public.** Respecting the mandate, documenting unvalidated assumptions and choosing the right channel to escalate is often the stronger play.
- **"How many tests did you write?" sounds like an exam.** "What evidence do we need to ship on Friday at an acceptable risk?" turns the same doubt into a shared decision.
- **A defensive reaction is not always your fault.** People also resist because of incentives and prior commitments. A coach that blames every bad reaction on the trainee's wording is teaching the wrong thing.

### Principles that follow

1. **Truth before niceness.** Diplomacy never costs a fact. A clear "no" can be the best answer.
2. **Actor and coach are strictly separate.** The simulated executive never sees the rubric, the coach's notes or your profile.
3. **Coaching is grounded in evidence.** Claims quote what you actually said; several different answers can be right; nothing is rewritten for style alone.
4. **Difficulty changes the conditions, never who the character is.**
5. **Speaking is the main mode.** Walk trains spoken reflexes; Desktop trains deliberate writing; Driving is listening and reflection only, with nothing to touch or answer.
6. **Your data stays on your device.** IndexedDB and portable JSON; no accounts, no server, no sync by default.
7. **Honest about keys.** A key used in a browser is not a server-side secret, and the app says so.
8. **Lean on purpose.** No agent frameworks, no SaaS, no addictive gamification.
9. **Memory you can inspect.** The coach forms hypotheses over many sessions, shows its evidence, and changes its mind for better evidence — not because you pushed back.
10. **Scenarios have hidden facts and causal rules**, so afterwards you can ask *why* someone objected and get an answer that separates scenario fact, plausible interpretation and counterfactual — never a pretence of reading a model's mind.

## What you can do with it

- **Walk** (spoken, half-duplex with explicit turn-taking), **Desktop** (written, with drafts) and **Driving** (a prepared audio briefing; listening only).
- **Easy / Medium / Hard**, and three coaching styles: immediate micro-feedback with retry, end-of-kata, or a Socratic question first.
- Drills: quick kata, power question, reframing, executive pressure, compact full simulation, and A/B replay on frozen scenario facts.
- Timed sessions where only active training consumes the budget; pauses, feedback and the coach dialogue never do.
- An untimed **coach dialogue** after each kata, with statements labelled and cited by turn.
- A **dashboard** that refuses to overclaim from sparse evidence, a provisional **SWOT** that needs many varied sessions, and tentative plateau signals.
- An editable, offline **power-question library**, with when *not* to use each question.
- Five executive voices and three scenarios in Spanish and English, plus your own Markdown actors and scenarios imported at runtime.
- Full export/import as JSON/ZIP. API keys are never part of an export.

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL. Without a key the app runs in **Demo** mode: scripted replies and heuristic scores, enough to try every screen offline, clearly labelled as not real coaching.

### Bring your own key

Either paste a key in **Settings**, or, for local development, copy `.env.example` to `.env.local` and fill in the providers you use. Whatever is present is offered in the app:

| Provider | Variable | Default model |
|---|---|---|
| Anthropic (Claude) | `VITE_ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| OpenAI (ChatGPT models) | `VITE_OPENAI_API_KEY` | `gpt-5.6-sol` |
| Google Gemini | `VITE_GEMINI_API_KEY` | `gemini-3.6-flash` |
| Any OpenAI-compatible endpoint | `VITE_CUSTOM_BASE_URL` (+ optional `VITE_CUSTOM_API_KEY`) | set `VITE_CUSTOM_MODEL` |

Actor and coach models can be set separately (`VITE_<PROVIDER>_ACTOR_MODEL`, `VITE_<PROVIDER>_COACH_MODEL`) or in Settings; `VITE_DEFAULT_PROVIDER` picks the preselected one.

> **Keys in `.env` are for local use only.** Vite inlines `VITE_*` values into the JavaScript bundle, so `npm run build` refuses to run while any `VITE_*_API_KEY` is set, unless you pass `ALLOW_KEYS_IN_BUNDLE=1` for a private, personal build. For a hosted copy, build without keys and enter the key in Settings.

Calls go straight from the browser to the provider you chose; there is no proxy. Whether a provider accepts direct browser calls depends on its CORS policy, and the connection check in Settings reports the real result. On Claude models that support it, the Anthropic adapter enables server-side refusal fallback.

## Architecture

```text
Static PWA: TypeScript + React + Vite + service worker (no application server)
  src/content     Markdown/YAML parsing, validation, bilingual registry, snapshots, pack import
  src/engine      Deterministic session state machine, timer and pause policy, controller
  src/llm         Provider adapters (Anthropic, OpenAI, Gemini, compatible), prompt composer,
                  separate actor and coach clients, offline demo clients
  src/evaluation  Schema and evidence validation of coach output
  src/scenario    Hidden world state, revelation rules, causal events
  src/memory      Local Memory Manager: five scopes, proposals validated by code
  src/insights    Dashboard statistics, SWOT stages, plateau signals, recommendations
  src/debrief     Untimed coach dialogue and causal postmortem
  src/speech      Browser speech recognition and synthesis, wake lock, voice commands
  src/storage     IndexedDB repository, JSON/ZIP backup and import
  src/ui          Screens
voices/ scenarios/ coaches/ profiles/ templates/   Bilingual content packs (en, es)
locales/          UI catalogs (en, es-ES)
schemas/          JSON contracts and examples
```

## Testing

```bash
npm test            # unit and integration tests (Vitest)
npm run test:e2e    # end-to-end against the production build (Playwright, demo provider)
npm run typecheck
npm run calibrate   # optional: runs the coach on curated fixtures with a real provider key
```

The automated suite covers the state machine and timing, provider-failure handling without duplicate turns, actor/coach context isolation, evaluation validation against the JSON Schema, memory and SWOT thresholds, causal traces and replay, backup round trips without secrets, and Spanish/English parity of content and UI text.

## Status and honest limits

Version 0.5 is a working MVP, verified by automated tests in desktop Chrome with the demo provider. Not yet verified, and needing a person with real devices and keys:

- **Spoken Walk mode on real iOS and Android devices** (microphone, speech synthesis, wake lock). The app feature-detects each capability and falls back to typing with captions, but browser speech support varies and background audio with a locked screen is not guaranteed anywhere, least of all on iOS.
- **Live calls to each provider from a browser.** The adapters are implemented against the providers' documented APIs; run the connection check in Settings with your own key.
- **Coach calibration.** LLM scores vary between runs. `npm run calibrate` checks the coach against curated fixtures once a key is available.

This is a practice tool. It is not therapy, not an HR assessment, and not a diagnosis.

## Documentation

- [Project context and motivation](CONTEXT.en.md) · [Español](CONTEXT.md)
- [Architecture decisions](docs/en/DECISIONS.md) · [Español](docs/es/DECISIONES.md)
- [Content authoring guide](docs/en/CONTENT.md) · [Español](docs/es/CONTENIDO.md)

The working specification (`SPECS.md`) is kept locally and is deliberately not tracked in the repository.
