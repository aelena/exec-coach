# Executive Reflexes

**Un gimnasio de práctica deliberada para la comunicación ejecutiva.** Katas orales breves frente a directivos simulados, un coach independiente y una revisión causal de lo que ocurrió y por qué. Una PWA instalable, principalmente oral, local-first, con tu propia clave (BYOK) y sin backend.

[English](README.en.md)

## Por qué existe

Este proyecto nace de una conversación socrática sobre la autoeficacia de Albert Bandura: uno llega a creerse capaz de algo haciéndolo, repetidamente, en condiciones realistas, y viéndose acertar. La habilidad en cuestión es lo que llamamos **reflejos ejecutivos**: detectar, *mientras la reunión todavía está ocurriendo*, la premisa sin validar, la contradicción de negocio, el incentivo que nadie menciona, el riesgo político, el elefante en la sala; y después intervenir con firmeza sin amenazar innecesariamente la posición de nadie.

El primer usuario es un CTO y asesor tecnológico con experiencia. El criterio técnico ya está. Lo que necesita práctica es la parte espontánea: la brevedad, la amplitud estratégica, la sensibilidad política y decir algo difícil de forma que se pueda escuchar.

> **El objetivo no es ser más complaciente ni más educado. Es influir sin perder rigor.**

### Lo que enseñaron los ejercicios originales

Los escenarios incluidos proceden de sesiones reales de práctica, y cada uno trae una lección que dio forma al diseño:

- **Un asistente de IA «completo» en seis semanas**, sin conjunto de evaluación ni criterios de aceptación. La jugada es separar el compromiso comercial de las condiciones técnicas para cumplirlo: negarse a la garantía sin respaldo, ofrecer una entrega acotada y verificable, y respetar lo que el contrato dice de verdad.
- **Automatizar 200.000 horas** no equivale a ahorrar ese dinero. Capacidad liberada, ahorro en caja, contratación evitada y capacidad reasignada son cuatro cosas distintas, y solo algunas llegan a las cuentas.
- **Un asesor externo no tiene por qué cuestionar en público la estrategia del CEO.** Respetar el mandato, documentar las premisas no validadas y elegir el canal adecuado para escalar suele ser la jugada más sólida.
- **«¿Cuántos tests habéis escrito?» suena a examen.** «¿Qué evidencia necesitamos para salir el viernes con un riesgo aceptable?» convierte la misma duda en una decisión compartida.
- **Una reacción defensiva no siempre es culpa tuya.** La gente también se resiste por incentivos y compromisos previos. Un coach que atribuye toda mala reacción a la formulación del alumno enseña lo que no es.

### Principios que se derivan

1. **Verdad antes que amabilidad.** La diplomacia nunca cuesta un hecho. Un «no» claro puede ser la mejor respuesta.
2. **Actor y coach están estrictamente separados.** El directivo simulado nunca ve la rúbrica, las notas del coach ni tu perfil.
3. **El coaching se apoya en evidencia.** Las afirmaciones citan lo que dijiste; varias respuestas distintas pueden ser correctas; nada se reescribe solo por estilo.
4. **La dificultad cambia las condiciones, nunca quién es el personaje.**
5. **Hablar es el modo principal.** Walk entrena reflejos orales; Desktop, la escritura reflexiva; Driving es solo escucha y reflexión, sin nada que tocar ni responder.
6. **Tus datos se quedan en tu dispositivo.** IndexedDB y JSON portable; sin cuentas, sin servidor y sin sincronización por defecto.
7. **Honestidad con las claves.** Una clave usada en un navegador no es un secreto de servidor, y la app lo dice.
8. **Sobria a propósito.** Sin frameworks de agentes, sin SaaS, sin gamificación adictiva.
9. **Memoria que puedes inspeccionar.** El coach formula hipótesis a lo largo de muchas sesiones, muestra su evidencia y cambia de opinión ante mejor evidencia, no porque insistas.
10. **Los escenarios tienen hechos ocultos y reglas causales**, de modo que después puedes preguntar *por qué* alguien objetó y recibir una respuesta que separa hecho del escenario, interpretación plausible y contrafactual, sin fingir que se lee la mente de un modelo.

## Qué puedes hacer

- **Walk** (oral, semidúplex con turnos explícitos), **Desktop** (escrito, con borradores) y **Driving** (un repaso en audio preparado de antemano; solo escucha).
- **Fácil / Medio / Difícil**, y tres estilos de coaching: microfeedback inmediato con reintento, al finalizar el kata, o una pregunta socrática primero.
- Ejercicios: kata rápido, power question, reformulación, presión ejecutiva, simulación completa compacta y repetición A/B sobre hechos de escenario congelados.
- Sesiones cronometradas en las que solo el entrenamiento activo consume el presupuesto; las pausas, el feedback y el diálogo con el coach nunca lo hacen.
- Un **diálogo con el coach** sin cronómetro tras cada kata, con afirmaciones etiquetadas y citadas por turno.
- Un **panel de progreso** que se niega a sacar conclusiones de poca evidencia, un **SWOT** provisional que exige muchas sesiones variadas y señales tentativas de meseta.
- Una **biblioteca de power questions** editable y disponible sin conexión, con cuándo *no* usar cada pregunta.
- Cinco voces ejecutivas y tres escenarios en español e inglés, además de tus propios actores y escenarios en Markdown importados en tiempo de ejecución.
- Exportación e importación completas en JSON/ZIP. Las claves API nunca forman parte de una exportación.

## Inicio rápido

```bash
npm install
npm run dev
```

Abre la URL que se muestra. Sin clave, la app funciona en modo **Demo**: respuestas guionizadas y puntuaciones heurísticas, suficiente para probar todas las pantallas sin conexión y claramente marcado como coaching no real.

### Trae tu propia clave

Pega una clave en **Configuración** o, para desarrollo local, copia `.env.example` a `.env.local` y rellena los proveedores que uses. Lo que esté presente se ofrece en la app:

| Proveedor | Variable | Modelo por defecto |
|---|---|---|
| Anthropic (Claude) | `VITE_ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| OpenAI (modelos de ChatGPT) | `VITE_OPENAI_API_KEY` | `gpt-5.6-sol` |
| Google Gemini | `VITE_GEMINI_API_KEY` | `gemini-3.6-flash` |
| Cualquier endpoint compatible con OpenAI | `VITE_CUSTOM_BASE_URL` (+ `VITE_CUSTOM_API_KEY` opcional) | define `VITE_CUSTOM_MODEL` |

Los modelos del actor y del coach pueden fijarse por separado (`VITE_<PROVEEDOR>_ACTOR_MODEL`, `VITE_<PROVEEDOR>_COACH_MODEL`) o en Configuración; `VITE_DEFAULT_PROVIDER` elige el preseleccionado.

> **Las claves en `.env` son solo para uso local.** Vite incrusta los valores `VITE_*` en el bundle de JavaScript, así que `npm run build` se niega a ejecutarse mientras haya algún `VITE_*_API_KEY` definido, salvo que indiques `ALLOW_KEYS_IN_BUNDLE=1` para una compilación privada y personal. Para una copia alojada, compila sin claves e introduce la clave en Configuración.

Las llamadas van directamente del navegador al proveedor elegido; no hay proxy. Que un proveedor acepte llamadas directas desde el navegador depende de su política CORS, y la comprobación de conexión de Configuración informa del resultado real. En los modelos de Claude que lo admiten, el adaptador de Anthropic activa el fallback de rechazos en el servidor.

## Arquitectura

```text
PWA estática: TypeScript + React + Vite + service worker (sin servidor de aplicación)
  src/content     Parseo de Markdown/YAML, validación, registro bilingüe, snapshots, importación de packs
  src/engine      Máquina de estados determinista, cronómetro y política de pausas, controlador
  src/llm         Adaptadores de proveedor (Anthropic, OpenAI, Gemini, compatibles), compositor de prompts,
                  clientes separados de actor y coach, clientes demo sin conexión
  src/evaluation  Validación de esquema y de evidencia de la salida del coach
  src/scenario    Estado oculto del mundo, reglas de revelación, eventos causales
  src/memory      Gestor de memoria local: cinco ámbitos, propuestas validadas por código
  src/insights    Estadísticas del panel, etapas del SWOT, señales de meseta, recomendaciones
  src/debrief     Diálogo con el coach sin cronómetro y postmortem causal
  src/speech      Reconocimiento y síntesis de voz del navegador, wake lock, comandos de voz
  src/storage     Repositorio IndexedDB, copia e importación JSON/ZIP
  src/ui          Pantallas
voices/ scenarios/ coaches/ profiles/ templates/   Packs de contenido bilingües (en, es)
locales/          Catálogos de interfaz (en, es-ES)
schemas/          Contratos JSON y ejemplos
```

## Pruebas

```bash
npm test            # pruebas unitarias y de integración (Vitest)
npm run test:e2e    # extremo a extremo sobre la compilación de producción (Playwright, proveedor demo)
npm run typecheck
npm run calibrate   # opcional: ejecuta el coach sobre casos curados con una clave real
```

La suite automatizada cubre la máquina de estados y los tiempos, los fallos de proveedor sin turnos duplicados, el aislamiento de contextos entre actor y coach, la validación de evaluaciones contra el JSON Schema, la memoria y los umbrales del SWOT, las trazas causales y la repetición, las copias de seguridad sin secretos y la paridad español/inglés de contenido y textos de interfaz.

## Estado y límites, con franqueza

La versión 0.5 es un MVP funcional, verificado con pruebas automatizadas en Chrome de escritorio con el proveedor demo. Queda por verificar, y requiere una persona con dispositivos y claves reales:

- **El modo oral Walk en dispositivos iOS y Android reales** (micrófono, síntesis de voz, wake lock). La app detecta cada capacidad y recurre a la escritura con subtítulos, pero el soporte de voz varía entre navegadores y el audio en segundo plano con la pantalla bloqueada no está garantizado en ninguna parte, y menos en iOS.
- **Las llamadas reales a cada proveedor desde un navegador.** Los adaptadores están implementados según las API documentadas de los proveedores; ejecuta la comprobación de conexión de Configuración con tu propia clave.
- **La calibración del coach.** Las puntuaciones de un LLM varían entre ejecuciones. `npm run calibrate` contrasta el coach con casos curados cuando hay una clave disponible.

Es una herramienta de práctica. No es terapia, ni una evaluación de RR. HH., ni un diagnóstico.

## Documentación

- [Contexto y motivación del proyecto](CONTEXT.md) · [English](CONTEXT.en.md)
- [Decisiones de arquitectura](docs/es/DECISIONES.md) · [English](docs/en/DECISIONS.md)
- [Guía para crear contenido](docs/es/CONTENIDO.md) · [English](docs/en/CONTENT.md)

La especificación de trabajo (`SPECS.md`) se conserva en local y deliberadamente no se versiona en el repositorio.
