# Encuentros

Aplica `campaign_encounters` después de visibilidad y antes del frontend.
Los combatientes privados se guardan con RLS de director. Los jugadores reciben
una proyección de los turnos revelados sin puntos de golpe ni notas. El cierre
con botín es atómico y vincula los ingresos con el encuentro y la sesión.
Los cambios de turno usan una revisión para evitar que dos envíos avancen dos
veces. El presupuesto de PX mostrado es configurable por el director y no
codifica una tabla oficial de dificultad.
