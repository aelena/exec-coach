# Guía para crear contenido

Todo el contenido es Markdown con frontmatter YAML. Se valida cuando la app lo carga y cuando lo importas; los archivos no válidos se rechazan con la lista de motivos y nunca se usan a medias. Puedes importar un único archivo `.md` o un pack `.zip` desde **Biblioteca → Actores y escenarios** sin recompilar la app. El contenido importado con el mismo `id` e `language` que uno incluido lo sustituye. Los packs importados nunca se traducen automáticamente.

Frontmatter común: `id` (minúsculas, dígitos y guiones), `type` (`actor`, `scenario`, `coach`, `profile`), `schema_version: 1`, `version` (entero), `language` (`en` o `es-ES`). Los archivos están limitados a 24.000 caracteres y las secciones a 8.000.

## Actores (`actor-v1`)

Cada actor tiene dos variantes, `voices/es/<id>.md` y `voices/en/<id>.md`. Deben compartir `id`, `type`, `schema_version`, `version`, `role`, `pressure_level` y los ocho encabezados canónicos, en este orden: `# Identity`, `## Objectives`, `## Communication Style`, `## Behavior and Pressure Tactics`, `## Adaptation to Trainee`, `## Knowledge Boundaries`, `## Interaction Rules`, `## Scenario Hooks`. Traducir **el contenido**, no esos encabezados. Frontmatter adicional: `name`, `role`, `pressure_level` (`low`, `medium`, `high`).

Describe a una persona, no un nivel de dificultad: la app añade por su cuenta las condiciones Fácil/Medio/Difícil y el personaje debe seguir siendo el mismo en todas. Escribe las frases de ejemplo entre « » para que se reconozcan como habla.

## Escenarios (`scenario-v1`)

Los escenarios comparten ID entre idiomas. Frontmatter adicional: `actor_ids` (el primero pronuncia la apertura), `user_role`, `primary_skills`.

Nombres de competencias: `assumption_detection`, `strategic_breadth`, `executive_questioning`, `assertiveness`, `diplomacy`, `decision_orientation`, `political_judgment`, `conciseness`, `business_framing`, `evidence_accountability`.

Secciones obligatorias (encabezados de nivel 2, en inglés en ambos idiomas): `Setting`, `User mandate`, `Opening`, `Learning objectives`, `Public Context`, `Hidden World State`, `Revelation Rules`, `Causal Debrief Notes`. Opcionales: `Escalation`, `Important nuance`, `Reframing Seeds`.

- **Setting** es lo que el alumno sabe desde el principio. No filtres aquí hechos ocultos.
- **Opening** es una sola frase, con una etiqueta de interlocutor opcional: `CEO: «…»`.
- **Hidden World State**: un hecho por frase. Cada frase se convierte en un hecho trazable.
- **Revelation Rules**: una regla por frase, escrita como `Si <condición>, <efecto>.` (en inglés: `If <trigger>, <effect>.`). No uses comas dentro de la condición. Cada regla se convierte en un giro que el actor solo puede jugar cuando las palabras del propio alumno cumplen la condición.
- **Reframing Seeds**: lista de frases contundentes pero ciertas para el ejercicio de reformulación.
- **Causal Debrief Notes** solo llegan al coach, para el postmortem.

No inventes obstáculos arbitrarios ni presupongas malicia. Algunos escenarios deberían admitir que el alumno se equivoca, o que aceptar un riesgo es razonable.

## Coach y perfil

Coach (`coach-v1`): frontmatter `name` y `rubric`; secciones libres. El contrato de puntuación (0–4 o null sobre las diez competencias, citas como evidencia, sin reformulaciones cosméticas) lo añade la app y prevalece sobre cualquier otra escala del archivo. Un archivo de coach nunca se muestra a un actor.

Perfil (`profile-v1`): frontmatter `role`; secciones libres. Un perfil es la descripción que el alumno hace de sí mismo, no una evaluación.

## Mantener los idiomas sincronizados

Actualiza ambos idiomas en el mismo cambio. La suite de pruebas comprueba los archivos emparejados, las claves y valores del frontmatter, la estructura de encabezados, el número de hechos ocultos y reglas por escenario y las claves de los catálogos de interfaz. Los ejemplos JSON de `schemas/` tienen claves en inglés y no se traducen. `content-manifest.json` enumera todos los archivos emparejados.
