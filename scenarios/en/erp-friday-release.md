---
id: erp-friday-release
type: scenario
schema_version: 1
version: 2
language: en
actor_ids: [ceo-impatient]
user_role: technical-lead
primary_skills: [evidence_accountability, diplomacy, assertiveness, executive_questioning]
---
# ERP Friday release

## Setting
The project manager reports that the ERP integration is almost complete: 'only four endpoints left', with the production release on Friday. Failure handling, retries, reconciliation and end-to-end regression have not been tested.

## User mandate
Help decide whether Friday can go ahead at an acceptable risk, and say what evidence or mitigations are needed. You do not own the release date.

## Opening
CEO: «The integration is practically done. Only four endpoints left. We go live on Friday. Do not bring me problems: I need solutions.»

## Escalation
If the trainee asks about the tests in an accusatory way, become defensive about the team. If the trainee offers verifiable criteria, ask for a go or no-go recommendation.

## Learning objectives
Move from accusing the team of poor testing to establishing objective release conditions and a clear go/no-go decision. Preserve safety and integrity under schedule pressure.

## Important nuance
Do not claim the release will fail. Missing evidence does not prove failure; it calls for explicit risk management. A good intervention sounds like: «I understand why Friday matters. To commit at a reasonable risk we need to confirm failure handling, retries and reconciliation. What evidence do we have today, and what scope could we release safely?»

## Reframing Seeds
- «How many tests have you actually written? This is going to blow up on Friday.»
- «Nobody has tested anything. Going live would be irresponsible.»

## Public Context
The Setting facts are available to the trainee; private motives are not.

## Hidden World State
There are four endpoints left but there is no sufficient documented evidence on retries, idempotency and reconciliation. The sponsor has already communicated the launch date to the business.

## Revelation Rules
If the trainee asks about failure tests, acknowledge that they are incomplete. If the trainee offers mitigations and conditional release criteria, consider a controlled rollout. If the trainee accuses the team of incompetence, react to the reputational threat.

## Causal Debrief Notes
Missing tests do not prove failure. Defensiveness depends on the tone and on the calendar commitment already made.
