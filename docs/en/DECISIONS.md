# Architecture decisions — v0.5

## Baseline decisions

1. Static, local-first BYOK PWA; no proprietary backend or accounts.
2. IndexedDB storage; JSON as canonical export and backup format.
3. Voice-first Walk, written Desktop, low-demand listening/reflection-only Driving.
4. Actor and coach use isolated contexts; actor personality stays invariant across difficulty.
5. Five inspectable local memory scopes; LLM proposes and validated code persists.
6. SWOT is longitudinal and provisional; authoritative coach revises organically on evidence.
7. Self-contained scenarios with hidden facts and causal revelations; long-running campaigns outside MVP.
8. Untimed conversational postmortem with event traces, never private model chain of thought.
9. All Markdown/docs ES/EN; English code/keys and canonical structural headings.
10. Direct BYOK subject to browser/provider CORS/security; no hidden proxy.

## Implementation records

Short records of choices made while building v0.5, including deviations from the baseline documents.

11. **Scoring scale is 0–4 over ten skills.** The shipped coach Markdown said "1–5" over eight dimensions; the specification and `schemas/evaluation.schema.json` say 0–4 or null over ten. The specification wins: the coach files were updated in both languages and the orchestrator contract restates the scale in every coach prompt.
12. **Scenario content was normalized into true EN/ES pairs.** The original English scenarios carried Spanish dialogue and the two locales told slightly different stories. Each scenario now has the same sections, facts, rules and actors in both languages, and skill names are canonical (`evidence_accountability`, not `evidence`). Aliases are still accepted, with a warning, in imported packs.
13. **`scenario-v1` sections.** Required level-2 headings: `Setting`, `User mandate`, `Opening`, `Learning objectives`, `Public Context`, `Hidden World State`, `Revelation Rules`, `Causal Debrief Notes`. Optional: `Escalation`, `Important nuance`, `Reframing Seeds`. The opening line is spoken by the first actor in `actor_ids`. Headings stay in English in both locales, like actor headings.
14. **Twists are declared in prose and identified by position.** Each sentence of `Revelation Rules` ("If …, …") becomes a twist `<scenario-id>#rev-N`; each sentence of `Hidden World State` becomes a fact `<scenario-id>#fact-N`. The actor reports which rule ids it acted on; the app accepts only declared, not-yet-revealed ids and logs them as `scenario_fact` causal events. The actor's own account of a reaction is logged separately as `model_interpretation` over a closed vocabulary. Trade-off: reordering rule sentences changes ids for new sessions; existing sessions keep their frozen snapshot.
15. **The opening line is scripted, not generated.** Every run of a scenario starts from identical pressure, which makes replays comparable and removes one provider call.
16. **Evaluation is validated by hand-written code, not a compiled JSON-Schema validator.** Schema compilers generate code at runtime and would require `unsafe-eval`, which the Content Security Policy forbids. A unit test checks the validator against `evaluation.schema.json` using the same cases.
17. **Evidence grounding is enforced by the app.** Quotes that do not occur in the transcript are removed and counted; an evaluation with no verifiable quote is capped at low confidence; a reframe is kept only when the coach says one is needed.
18. **Several providers, one adapter interface.** Anthropic (official SDK with explicit browser opt-in), OpenAI and OpenAI-compatible endpoints (Chat Completions), and Google Gemini (`generateContent`). Actor and coach always run as separate requests with separate system prompts, and may use different models. An offline Demo provider with scripted replies exists for onboarding and automated tests and is labelled as not real coaching.
19. **Keys from `.env` are a local convenience guarded at build time.** `VITE_*_API_KEY` values are loaded into volatile memory at start-up. Because Vite inlines them into the bundle, `vite build` fails when any is set unless `ALLOW_KEYS_IN_BUNDLE=1`. Keys entered in the app stay in memory unless the user opts in to local persistence, which uses a store that backup code never reads.
20. **Content Security Policy.** Production builds ship a strict policy (`script-src 'self'`, no inline scripts, no `eval`). `connect-src` allows any HTTPS origin because BYOK endpoints are user-configured, plus localhost for local model servers. `style-src` allows inline style attributes for score bars. The policy is injected only at build time because the development server needs inline scripts.
21. **Speech uses the browser's Web Speech API.** Half-duplex with explicit turn-taking: tap to speak, tap to send, so deliberate pauses never end a turn. No raw audio is captured or stored by the app. Provider-hosted speech services are behind the same adapter boundary but are not implemented in the MVP.
22. **A session is one kata with a time budget.** The planned duration bounds a single kata; the clock runs only in the actor-turn, user-turn and evaluating states. Reading feedback, the Socratic reflection and the coach dialogue are untimed. Chaining several katas under one long budget is left for later.
23. **Driving mode never creates a simulation.** It builds an audio briefing from local data before the drive (last recap, pending learning pointers, three questions with silence) and exposes a single stop control while playing. No model call, no microphone.
24. **SWOT, plateau signals and recommendations are deterministic.** They are computed from stored evaluations with named, configurable thresholds, so every item links to its evidence and counterexamples. No model writes the SWOT.
25. **Memory scopes in practice.** `short_term` is the live transcript and is not stored. `entity` records contain only the trainee's own earlier words to that stakeholder, the one thing an actor may recall. `coach` records start provisional and become supported after three distinct sessions agree. `long_term` holds outcome summaries computed by the app. `user` holds what the trainee says about themselves.
26. **Open items requiring people and devices.** Spoken Walk mode on real iOS and Android hardware, live provider calls from a browser with real keys, and coach calibration against the curated fixtures have not been verified by the automated suite.
