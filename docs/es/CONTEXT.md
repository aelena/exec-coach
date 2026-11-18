# CONTEXT — Executive Reflexes / Corporate Kata Gym

## Por qué existe
Esta aplicación nace de una conversación socrática sobre la autoeficacia de Albert Bandura y el desarrollo de «reflejos corporativos»: la capacidad de detectar en tiempo real las premisas no validadas, contradicciones de negocio, incentivos, riesgos y «elefantes en la sala», y comunicar una intervención firme sin provocar defensividad innecesaria. Su primer usuario es un CTO y asesor tecnológico experimentado, con confianza técnica elevada, que busca mejorar la espontaneidad, la diplomacia, la brevedad y el pensamiento estratégico en reuniones con ejecutivos. **No necesita aprender a ser más complaciente; necesita que sus mensajes tengan más influencia sin perder rigor.**

## Lo aprendido en los katas originales
- Una promesa de entregar un asistente de IA completo en seis semanas, sin dataset de evaluación ni criterios de aceptación, requiere distinguir el compromiso comercial de las condiciones técnicas para cumplirlo.
- «No puedo garantizar el producto completo; sí puedo comprometer una entrega acotada con criterios medibles» es mejor que una objeción larga o una falsa aceptación.
- Automatizar 200.000 horas no implica ahorro contable si se mantiene la plantilla; puede crear capacidad para absorber crecimiento, pero ese beneficio exige estrategia, demanda y reasignación.
- Un consultor técnico externo no tiene por qué cuestionar en público toda la estrategia del CEO: debe respetar su mandato, hacer explícitas las hipótesis no validadas y, cuando proceda, escalar en privado.
- «¿Cuántos tests tenéis?» puede sonar a examen; «¿qué evidencia necesitamos para salir el viernes con un riesgo aceptable?» convierte el conflicto en decisión compartida.
- No siempre es culpa del estilo: también hay incentivos para ignorar advertencias. El coach no debe atribuir al usuario toda reacción adversa.

## Qué construir
Una PWA **voice-first, local-first, BYOK y sin backend propio**, con actores ejecutivos configurados por Markdown, un coach LLM independiente, katas orales breves, entrenamiento escrito reflexivo, niveles Easy/Medium/Hard, feedback inmediato/final/socrático, biblioteca de power questions, dashboard, reintentos A/B e historial local JSON exportable/importable. Idioma inicial es-ES, producto y documentación multilingües (en desde MVP). Código y nombres de métodos en inglés.

## Principios innegociables
1. Verdad antes que amabilidad; diplomacia sin concesión factual.
2. Separación estricta entre actor y coach; no compartir secretos ni rúbrica con el actor.
3. El coach evalúa el contenido y la pertinencia contextual, no solo el tono; admite múltiples respuestas válidas y reconoce cuando no hace falta reformular.
4. Dificultad cambia condiciones y presión, **no la identidad de la voz**.
5. Interfaz oral principal; Desktop es una modalidad distinta para comunicación escrita deliberada.
6. Driving Mode: solo contenido de baja demanda cognitiva, sin lectura, interacción manual ni presión intensa. Nunca fomentar el uso distractor al volante.
7. Persistencia en IndexedDB con JSON canónico por sesión; archivos exportables. Sin servidor ni sincronización por defecto.
8. Claves BYOK no pueden considerarse secretos seguros dentro del navegador. No registrar claves en sesiones ni logs.
9. Markdown de actores uniforme y validable; escenarios y coach configurables por archivos separados.
10. Mantener MVP KISS/YAGNI: sin agentes autónomos, sin SaaS, sin cuentas, sin gamificación adictiva.

## Instrucciones para el coding assistant
Leer primero CONTEXT.md, luego SPECS.md, docs/es/README.md y las plantillas. No introducir backend, base de datos remota, login, ni frameworks de agentes sin aprobación explícita. Resolver contradicciones documentales a favor de SPECS.md v0.5 y dejar ADR breve si una limitación técnica exige cambios. Implementar vertical slices probables, pruebas automatizadas y accesibilidad desde el inicio. Las respuestas del LLM son datos no confiables: validar JSON, aislar prompts y proteger claves. Mantener documentación en español e inglés sincronizada; añadir claves i18n para todo texto UI. No asumir soporte de voz en segundo plano ni BYOK universal. Priorizar un MVP demostrable en móvil real.


## Evolución v0.4 — relación longitudinal con el coach
El producto no es un chatbot puntuador: el usuario entrena katas cronometrados, conversa libremente con un coach fuera del tiempo de entrenamiento y conserva una memoria local verificable y editable. El coach mantiene hipótesis SWOT basadas en evidencias de sesiones, evita etiquetas psicológicas, detecta señales de fatiga sin diagnosticarlas y recomienda pausas o aprendizaje contextual. Los tiempos de entrenamiento pueden ser largos pero deben pausarse; el modo de conducción nunca debe demandar atención visual o presión cognitiva. Priorizar transferencia a escenarios nuevos y evitar enseñar frases de plantilla. Mantener el MVP sin backend y BYOK; explicar con transparencia los límites de privacidad y sincronización.


## Ampliación v0.5 — causalidad, memoria y diálogo
Los escenarios son acotados, pero pueden condensar meses de historia ficticia. Separar contexto conocido, hechos ocultos y reglas causales de revelación. Registrar eventos explicables, no cadenas privadas de pensamiento. Tras cada sesión, permitir postmortem conversacional con el coach y, opcionalmente, el actor fuera de personaje. El coach tiene criterio y revisa hipótesis solo ante mejor evidencia; el actor puede reconocer patrones únicamente si los habría observado. Evitar overfitting a frases preferidas por el juez. Los cinco ámbitos de memoria son lógicos y locales. No construir campañas longitudinales en el MVP. Toda la documentación y los packs Markdown incluidos deben tener versiones ES/EN; código y contratos en inglés.
