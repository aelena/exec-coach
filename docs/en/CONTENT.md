# Content authoring guide

All content is Markdown with YAML frontmatter. It is validated when the app loads it and when you import it; invalid files are rejected with a list of reasons and are never partially used. You can import a single `.md` file or a `.zip` pack from **Library → Actors and scenarios** without rebuilding the app. Imported content with the same `id` and `language` as a built-in overrides it. Imported packs are never translated automatically.

Common frontmatter: `id` (lowercase letters, digits, hyphens), `type` (`actor`, `scenario`, `coach`, `profile`), `schema_version: 1`, `version` (integer), `language` (`en` or `es-ES`). Files are limited to 24,000 characters and sections to 8,000.

## Actors (`actor-v1`)

Each actor has `voices/en/<id>.md` and `voices/es/<id>.md` variants. Keep `id`, `type`, `schema_version`, `version`, `role`, `pressure_level` and all eight canonical headings identical, in this order: `# Identity`, `## Objectives`, `## Communication Style`, `## Behavior and Pressure Tactics`, `## Adaptation to Trainee`, `## Knowledge Boundaries`, `## Interaction Rules`, `## Scenario Hooks`. Translate **prose**, not headings. Additional frontmatter: `name`, `role`, `pressure_level` (`low`, `medium`, `high`).

Describe a person, not a difficulty level: the app adds the Easy/Medium/Hard conditions itself and the character must stay the same across them. Put example lines inside « » so they are recognisable as speech.

## Scenarios (`scenario-v1`)

Scenarios share IDs across languages. Additional frontmatter: `actor_ids` (the first one speaks the opening), `user_role`, `primary_skills`.

Skill names: `assumption_detection`, `strategic_breadth`, `executive_questioning`, `assertiveness`, `diplomacy`, `decision_orientation`, `political_judgment`, `conciseness`, `business_framing`, `evidence_accountability`.

Required sections (level-2 headings, in English in both locales): `Setting`, `User mandate`, `Opening`, `Learning objectives`, `Public Context`, `Hidden World State`, `Revelation Rules`, `Causal Debrief Notes`. Optional: `Escalation`, `Important nuance`, `Reframing Seeds`.

- **Setting** is what the trainee knows from the start. Do not leak hidden facts here.
- **Opening** is one line, optionally prefixed with a speaker label: `CEO: «…»`.
- **Hidden World State**: one fact per sentence. Each sentence becomes a traceable fact.
- **Revelation Rules**: one rule per sentence, written as `If <trigger>, <effect>.` (Spanish: `Si <condición>, <efecto>.`). Keep commas out of the trigger part. Each rule becomes a twist the actor may play only when the trainee's own words meet the trigger.
- **Reframing Seeds**: a bullet list of blunt but true statements for the reframing drill.
- **Causal Debrief Notes** go to the coach only, for the postmortem.

Do not invent arbitrary obstacles and do not assume malice. Some scenarios should allow that the trainee is wrong, or that accepting a risk is reasonable.

## Coach and profile

Coach (`coach-v1`): frontmatter `name` and `rubric`; free-form sections. The scoring contract (0–4 or null over the ten skills, evidence quotes, no cosmetic rewrites) is added by the app and overrides any other scale in the file. A coach file is never shown to an actor.

Profile (`profile-v1`): frontmatter `role`; free-form sections. A profile is the trainee's own account, not an assessment.

## Keeping locales in step

Update both locales in the same change. The test suite checks paired files, frontmatter keys and values, heading structure, the number of hidden facts and rules per scenario, and UI catalog keys. JSON examples in `schemas/` have English keys and are not localized. `content-manifest.json` lists every paired file.
