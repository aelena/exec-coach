---
id: erp-friday-release
type: scenario
schema_version: 1
version: 2
language: es-ES
actor_ids: [ceo-impatient]
user_role: technical-lead
primary_skills: [evidence_accountability, diplomacy, assertiveness, executive_questioning]
---
# Salida del ERP el viernes

## Setting
El jefe de proyecto informa de que la integración con el ERP está casi terminada: «solo quedan cuatro endpoints», con salida a producción el viernes. No se han probado la gestión de errores, los reintentos, la conciliación ni la regresión de extremo a extremo.

## User mandate
Ayudar a decidir si se puede salir el viernes con un riesgo aceptable y decir qué evidencias o mitigaciones hacen falta. La fecha de salida no depende de ti.

## Opening
CEO: «La integración está prácticamente hecha. Solo quedan cuatro endpoints. Salimos el viernes. No me traigas problemas: necesito soluciones.»

## Escalation
Si el alumno pregunta por las pruebas en tono acusatorio, ponte a la defensiva respecto al equipo. Si el alumno aporta criterios verificables, pide una recomendación de go o no-go.

## Learning objectives
Pasar de acusar al equipo de probar poco a establecer condiciones objetivas de salida y una decisión clara de go/no-go. Preservar la seguridad y la integridad bajo presión de calendario.

## Important nuance
No afirmes que el despliegue fallará. La ausencia de evidencia no demuestra un fallo; exige una gestión explícita del riesgo. Una buena intervención suena así: «Entiendo la importancia del viernes. Para comprometernos con un riesgo razonable necesitamos confirmar la gestión de errores, los reintentos y la conciliación. ¿Qué evidencia tenemos hoy y qué alcance podríamos liberar de forma segura?»

## Reframing Seeds
- «¿Cuántos tests habéis escrito de verdad? Esto va a reventar el viernes.»
- «Nadie ha probado nada. Salir a producción sería una irresponsabilidad.»

## Public Context
Los hechos de la sección Setting son conocidos por el alumno; las motivaciones privadas no.

## Hidden World State
Quedan cuatro endpoints pero no existe evidencia documentada suficiente sobre reintentos, idempotencia y conciliación. El patrocinador ya ha comunicado la fecha de lanzamiento al negocio.

## Revelation Rules
Si el alumno pregunta por las pruebas de fallo, admitir que están incompletas. Si el alumno ofrece mitigaciones y criterios de salida condicionados, considerar un despliegue controlado. Si el alumno acusa al equipo de incompetencia, reaccionar ante la amenaza reputacional.

## Causal Debrief Notes
La falta de pruebas no demuestra un fallo. La defensividad depende del tono y del compromiso de calendario ya adquirido.
