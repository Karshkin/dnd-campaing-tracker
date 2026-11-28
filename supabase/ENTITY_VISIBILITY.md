# Descubrimiento y visibilidad

Aplica `campaign_entity_visibility` antes del frontend. Las entidades anteriores
conservan su acceso actual. Los directores pueden ocultarlas, compartirlas con
la campaña o revelarlas a los propietarios de personajes concretos. Las
reglas de descubrimiento complementan los permisos de cada sección. Los campos
privados existentes siguen siendo la vía para revelar información parcial.

Las políticas se aplican a los registros, vínculos de sesión, reputación,
comentarios, metadatos de imágenes y nuevas solicitudes de firma a Storage.
Los registros invisibles no se incluyen en las lecturas directas ni en los
resultados de búsqueda del cliente. Una URL firmada con anterioridad conserva
su vencimiento original.

Los módulos nuevos deben registrar su tabla en
`campaign_private.visibility_entities`, aplicar `can_discover` junto con su RLS
propia y comprobar el acceso al origen antes de publicar relaciones o actividad.
