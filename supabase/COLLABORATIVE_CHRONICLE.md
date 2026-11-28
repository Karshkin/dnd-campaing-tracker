# Diario colaborativo y misiones

Aplica la migración `collaborative_diary_and_quests` antes de publicar el
frontend. La migración amplía las entradas y misiones existentes y conserva
sus IDs, contenidos, imágenes y permisos de lectura compartida. Las entradas
sin autor se identifican como entradas anteriores y las puede editar el director.

Los jugadores firman con personajes propios y pueden crear entradas compartidas
o privadas y misiones grupales o personales. Las misiones distinguen la propuesta
de estado, editable por su autor, del estado oficial y las recompensas que
controla el director. Los vínculos y participantes se validan dentro de la campaña
al guardarse. Las imágenes privadas se firman con URLs de un minuto desde el
diario y las nuevas peticiones de firma requieren acceso a la entrada.

Ejecuta `npm run test:chronicle` contra una instancia desechable de Supabase con
las migraciones aplicadas. La suite comprueba autoría, visibilidad, vínculos,
imágenes, comentarios y progreso en Chromium y en la Data API.
