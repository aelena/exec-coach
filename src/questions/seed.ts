import { SCHEMA_VERSION, type AppLocale, type PowerQuestion, type QuestionCategory, type Skill } from '../domain/types';

// Built-in power-question library, bilingual and available offline. Users can edit, delete, add,
// import and export questions; built-ins are only (re)seeded when their id is missing.

interface Seed {
  slug: string;
  category: QuestionCategory;
  skills: Skill[];
  en: [text: string, whenToUse: string, whenNotToUse: string];
  es: [text: string, whenToUse: string, whenNotToUse: string];
}

const SEEDS: Seed[] = [
  {
    slug: 'what-must-be-true',
    category: 'assumptions',
    skills: ['assumption_detection', 'executive_questioning'],
    en: ['What would have to be true for this plan to work?', 'A target or date is presented as settled and nobody has named its dependencies.', 'The assumptions were already listed and agreed; asking again reads as stalling.'],
    es: ['¿Qué tendría que ser cierto para que este plan funcione?', 'Se presenta un objetivo o una fecha como cerrados y nadie ha nombrado sus dependencias.', 'Las premisas ya se han enumerado y acordado; repetirlo suena a dilación.'],
  },
  {
    slug: 'know-vs-assume',
    category: 'assumptions',
    skills: ['assumption_detection', 'evidence_accountability'],
    en: ['What do we know, and what are we assuming?', 'A number from a third party is being treated as a fact.', 'In a public forum where it would expose the sponsor of the number; raise it privately first.'],
    es: ['¿Qué sabemos y qué estamos suponiendo?', 'Una cifra de un tercero se está tratando como un hecho.', 'En un foro público donde dejaría en evidencia a quien patrocina la cifra; plantéalo antes en privado.'],
  },
  {
    slug: 'where-does-saving-land',
    category: 'economics',
    skills: ['business_framing', 'strategic_breadth'],
    en: ['Where exactly does this saving show up in the P&L?', 'Hours saved are being presented as money saved.', 'Before the mechanism is understood; first ask whether it is cost reduction or released capacity.'],
    es: ['¿Dónde aparece exactamente este ahorro en la cuenta de resultados?', 'Las horas ahorradas se presentan como dinero ahorrado.', 'Antes de entender el mecanismo; pregunta primero si es reducción de gasto o capacidad liberada.'],
  },
  {
    slug: 'capacity-or-cash',
    category: 'economics',
    skills: ['business_framing', 'assumption_detection'],
    en: ['Is this a cost reduction, or capacity we plan to redeploy?', 'Automation benefits are quoted without saying what happens to the freed time.', 'When headcount decisions are confidential and you are not the right person to open them.'],
    es: ['¿Es una reducción de gasto o capacidad que pensamos reasignar?', 'Se citan beneficios de automatización sin decir qué ocurre con el tiempo liberado.', 'Cuando las decisiones de plantilla son confidenciales y no te corresponde abrirlas.'],
  },
  {
    slug: 'who-gains-who-loses',
    category: 'incentives',
    skills: ['political_judgment', 'strategic_breadth'],
    en: ['Who gains and who loses if we do this?', 'A sound proposal meets resistance that the stated reasons do not explain.', 'Aloud in the room; this is usually a question to answer for yourself before you speak.'],
    es: ['¿Quién gana y quién pierde si hacemos esto?', 'Una propuesta sensata encuentra una resistencia que las razones declaradas no explican.', 'En voz alta en la sala; suele ser una pregunta para responderte antes de intervenir.'],
  },
  {
    slug: 'what-was-promised',
    category: 'incentives',
    skills: ['political_judgment', 'diplomacy'],
    en: ['What has already been promised, and to whom?', 'Someone defends a date harder than the facts justify.', 'As an accusation. Ask it to understand the commitment, not to assign blame.'],
    es: ['¿Qué se ha prometido ya, y a quién?', 'Alguien defiende una fecha con más fuerza de la que justifican los hechos.', 'Como acusación. Pregúntalo para entender el compromiso, no para repartir culpas.'],
  },
  {
    slug: 'value-to-customer',
    category: 'value',
    skills: ['business_framing', 'decision_orientation'],
    en: ['What is the smallest delivery the customer would recognise as valuable?', 'Scope is non-negotiable in theory and undeliverable in practice.', 'When the contract fixes scope and only a formal change request can alter it.'],
    es: ['¿Cuál es la entrega más pequeña que el cliente reconocería como valiosa?', 'El alcance es innegociable en teoría e inalcanzable en la práctica.', 'Cuando el contrato fija el alcance y solo un cambio formal puede modificarlo.'],
  },
  {
    slug: 'success-in-a-year',
    category: 'value',
    skills: ['strategic_breadth', 'executive_questioning'],
    en: ['A year from now, how will we know this was worth it?', 'A technology choice is being discussed before the outcome is defined.', 'In an execution meeting where the outcome was settled long ago.'],
    es: ['Dentro de un año, ¿cómo sabremos que esto ha merecido la pena?', 'Se discute la elección tecnológica antes de definir el resultado.', 'En una reunión de ejecución donde el resultado quedó fijado hace tiempo.'],
  },
  {
    slug: 'who-decides',
    category: 'governance',
    skills: ['decision_orientation', 'political_judgment'],
    en: ['Who makes this decision, and who has to live with it?', 'Accountability for a risk is diffuse and everyone assumes someone else owns it.', 'When ownership is clear and the question would only signal distrust.'],
    es: ['¿Quién toma esta decisión y quién tendrá que convivir con ella?', 'La responsabilidad de un riesgo es difusa y todos asumen que es de otro.', 'Cuando la responsabilidad está clara y la pregunta solo transmitiría desconfianza.'],
  },
  {
    slug: 'who-runs-it-after',
    category: 'governance',
    skills: ['strategic_breadth', 'assumption_detection'],
    en: ['Who operates this once the project team has gone?', 'A pilot is about to become production by default.', 'When operations are already represented and have agreed the handover.'],
    es: ['¿Quién opera esto cuando el equipo del proyecto se haya ido?', 'Un piloto está a punto de convertirse en producción por inercia.', 'Cuando operaciones ya está representada y ha acordado el traspaso.'],
  },
  {
    slug: 'evidence-to-ship',
    category: 'evidence',
    skills: ['evidence_accountability', 'diplomacy', 'decision_orientation'],
    en: ['What evidence do we need to ship on Friday at an acceptable risk?', 'A release is declared almost done and you doubt the untested paths.', 'Never as “how many tests did you write?” — that turns a shared decision into an exam.'],
    es: ['¿Qué evidencia necesitamos para salir el viernes con un riesgo aceptable?', 'Se da por casi terminada una entrega y dudas de los caminos no probados.', 'Nunca como «¿cuántos tests habéis escrito?»: convierte una decisión compartida en un examen.'],
  },
  {
    slug: 'acceptance-criteria',
    category: 'evidence',
    skills: ['evidence_accountability', 'assertiveness'],
    en: ['How will the customer decide that it works?', 'A commitment exists but nobody can state its acceptance criteria.', 'When criteria are written down; then ask whether they are measurable instead.'],
    es: ['¿Cómo decidirá el cliente que funciona?', 'Existe un compromiso pero nadie sabe enunciar sus criterios de aceptación.', 'Cuando los criterios están escritos; entonces pregunta si son medibles.'],
  },
  {
    slug: 'cost-of-being-wrong',
    category: 'risks',
    skills: ['strategic_breadth', 'business_framing'],
    en: ['If we are wrong, what does it cost and who finds out first?', 'Risk is being discussed as a probability with no consequence attached.', 'As a prediction of failure. Missing evidence is not proof that it will fail.'],
    es: ['Si nos equivocamos, ¿cuánto cuesta y quién se entera primero?', 'El riesgo se discute como probabilidad, sin consecuencia asociada.', 'Como predicción de fracaso. La falta de evidencia no demuestra que vaya a fallar.'],
  },
  {
    slug: 'reversible',
    category: 'risks',
    skills: ['decision_orientation', 'strategic_breadth'],
    en: ['Is this decision reversible, and until when?', 'The room is stuck between waiting for certainty and committing blindly.', 'When the decision is trivially reversible and the question only adds delay.'],
    es: ['¿Es reversible esta decisión, y hasta cuándo?', 'La sala está atascada entre esperar certezas y comprometerse a ciegas.', 'Cuando la decisión es trivialmente reversible y la pregunta solo añade retraso.'],
  },
  {
    slug: 'right-forum',
    category: 'politics',
    skills: ['political_judgment', 'diplomacy'],
    en: ['Is this something to raise here, or first in private?', 'Your point is valid and would corner a senior person in front of others.', 'When silence in the room would be read as agreement with a decision being taken now.'],
    es: ['¿Esto conviene plantearlo aquí o antes en privado?', 'Tu observación es válida y dejaría contra las cuerdas a alguien sénior delante de otros.', 'Cuando callar en la sala se interpretaría como conformidad con una decisión que se toma ahora.'],
  },
  {
    slug: 'what-decision-do-you-need',
    category: 'politics',
    skills: ['decision_orientation', 'conciseness'],
    en: ['What decision do you need from me today?', 'You are under pressure to commit and the actual ask is unclear.', 'As a way to dodge a direct yes-or-no that you are able to answer.'],
    es: ['¿Qué decisión necesitas de mí hoy?', 'Te presionan para comprometerte y la petición real no está clara.', 'Como forma de esquivar un sí o un no directo que estás en condiciones de dar.'],
  },
  {
    slug: 'who-has-to-change',
    category: 'adoption',
    skills: ['strategic_breadth', 'assumption_detection'],
    en: ['Whose daily work has to change for this to pay off?', 'Benefits are assumed to arrive as soon as the system is switched on.', 'When the affected teams are in the room and already resisting; ask them what they need instead.'],
    es: ['¿El trabajo diario de quién tiene que cambiar para que esto dé resultado?', 'Se da por hecho que los beneficios llegan en cuanto se enciende el sistema.', 'Cuando los equipos afectados están en la sala y ya se resisten; pregúntales qué necesitan.'],
  },
  {
    slug: 'what-stops-usage',
    category: 'adoption',
    skills: ['assumption_detection', 'business_framing'],
    en: ['What would stop people from using it?', 'Adoption is treated as a communication task rather than a design constraint.', 'When usage data already exists; look at it before speculating.'],
    es: ['¿Qué impediría que la gente lo use?', 'La adopción se trata como una tarea de comunicación y no como una restricción de diseño.', 'Cuando ya existen datos de uso; míralos antes de especular.'],
  },
];

export function seedQuestions(now: string): PowerQuestion[] {
  const build = (seed: Seed, locale: AppLocale, [text, whenToUse, whenNotToUse]: Seed['en']): PowerQuestion => ({
    id: `pq-${seed.slug}-${locale}`,
    schemaVersion: SCHEMA_VERSION,
    category: seed.category,
    locale,
    text,
    whenToUse,
    whenNotToUse,
    skills: seed.skills,
    builtin: true,
    createdAt: now,
    updatedAt: now,
  });
  return SEEDS.flatMap((seed) => [build(seed, 'en', seed.en), build(seed, 'es-ES', seed.es)]);
}
