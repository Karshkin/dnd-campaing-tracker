# Encuentros

Aplica `campaign_encounters` después de visibilidad y antes del frontend.
Los combatientes privados se guardan con RLS de director. Los jugadores reciben
una proyección de los turnos revelados sin puntos de golpe ni notas. El cierre
con botín es atómico y vincula los ingresos con el encuentro y la sesión.
Los cambios de turno usan una revisión para evitar que dos envíos avancen dos
veces. El presupuesto recomendado suma los PX de cada participante según su
nivel y presenta los tres niveles de dificultad.

Los umbrales de PX proceden de la tabla «XP Budget per Character» del
[System Reference Document 5.2.1](https://www.dndbeyond.com/srd) de Wizards of the Coast LLC,
licenciado bajo [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
La implementación suma los presupuestos individuales cuando el grupo mezcla niveles.
