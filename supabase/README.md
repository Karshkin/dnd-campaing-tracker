# Migración a Supabase y publicación en GitHub Pages

Proyecto previsto: `mldgsloebfpxciozyyyo`. La aplicación usa Auth, PostgreSQL 17,
Storage privado y permisos por campaña. Usa Node.js 24 para
compilar y una versión reciente de la CLI de Supabase para desplegar.

## 1. Preparar Supabase

1. Comprueba en el proyecto que el esquema `public` está vacío y habilitado en la Data API.
2. Aplica en orden los archivos de `supabase/migrations` desde la conversación con acceso a
   Supabase o con `supabase link --project-ref mldgsloebfpxciozyyyo` y `supabase db push`.
   Usa un solo método para registrar cada migración una vez. El SQL crea las tablas, las
   políticas, los permisos explícitos y el bucket privado `campaign-files`.
3. En Auth, habilita correo y contraseña y configura un mínimo de ocho caracteres. Usa
   `https://karshkin.github.io/dnd-campaing-tracker/` como **Site URL** y como destino
   permitido. Para registrar cuentas desde el frontend, habilita el registro y la confirmación
   de correo. Comprueba SMTP y los límites de correo del proyecto antes de invitar a los jugadores.

### Campañas y directores

En una instalación nueva, registra una cuenta con correo y contraseña e inicia sesión.
Pulsa **Crear campaña** para obtener acceso como director de esa campaña. En **Admin**
puedes añadir cuentas existentes por nombre de usuario y ajustar sus permisos en esa
campaña. El director también puede configurar el nombre, la descripción, el tema, el
color de acento, la portada y el emblema. Las imágenes admiten hasta 10 MB por archivo.

Un administrador de sección gestiona los miembros y permisos de esa misma campaña.
El director puede consultar los personajes y diarios de sus jugadores, además de
los retratos y galerías. Los campos privados solo se muestran al propietario.
Los propietarios editan las fichas y las imágenes. El inventario y los archivos de ficha
siguen reservados a sus propietarios. Los jugadores con acceso a Personajes ven una
lista de compañeros con su nombre, emoji, raza, clase, nivel y propietario. La sección
Admin reúne las cuentas y los permisos. La creación de criaturas, PNJ y organizaciones
está en cada sección para quienes pueden editarla. La carga y eliminación de mapas está
en la Crónica para quienes tienen permiso de administración. Los jugadores con acceso
a la Crónica pueden crear grupos abiertos o unirse a ellos en Recursos. El inventario
común suma aportaciones por categoría y nombre. Cada miembro puede corregir o retirar
sus propias aportaciones. Las aportaciones quedan en el grupo cuando un miembro sale. Los comentarios
en mapas, personajes, criaturas, PNJ y organizaciones los puede leer quien tenga
permiso para ver la sección. Solo se puede firmar con un personaje propio.

### Actualizar la instalación de Tiranía de los dragones

La migración de aislamiento conserva los IDs y las rutas de archivos, incorpora las
cuentas y roles existentes a **Tiranía de los dragones** y fija la campaña en los
registros anteriores. PostgreSQL comprueba pertenencia, permisos y relaciones en cada campaña.

Para el corte de producción, prueba estas dos migraciones primero contra una copia
desechable del esquema y de los datos, con clientes de dos campañas en PostgREST y
Storage. El workflow de Pages publica el frontend al fusionar. Coordina una ventana
de mantenimiento para hacer una copia de la base de datos y de Storage, aplicar las
migraciones de aislamiento y de Storage juntas, desplegar la versión retirada de
`manage-users` y publicar el frontend inmediatamente después. La interfaz anterior
deja de poder cargar su perfil al cambiar los permisos de la tabla. Comprueba el
acceso de las cuentas existentes y realiza una prueba de lectura y subida de imágenes
en dos campañas. Si hay que revertir, restaura juntos el esquema, la función y el
frontend anterior. La recuperación de contraseñas corresponde a la cuenta de Auth.

### Enlaces de registro y superadministración

Tras aplicar la migración de enlaces y superadministración, la URL de Tiranía de los
dragones usa `?campaign=tirania-de-los-dragones`. Los administradores pueden consultar
el enlace de registro y cambiar su identificador en **Admin → Configuración de campaña**.
Las cuentas nuevas creadas desde el enlace entran como jugadoras en esa campaña. Las
cuentas existentes pueden añadirse por nombre desde la gestión de miembros. Una cuenta
creada sin enlace queda a la espera de que se añada a una campaña. Cambiar el identificador
desactiva el enlace anterior sin cambiar las membresías.

La cuenta con el permiso global anterior conserva la superadministración. Este permiso
permite crear campañas, acceder a todas y asignar administradores por campaña. El
administrador de una campaña conserva sus permisos dentro de esa campaña. Solo un
operador de Supabase puede cambiar el permiso global en `public.profiles.is_admin`
para la cuenta que haya verificado.

Aplica `20261127165548_campaign_links_and_superadmin.sql` antes de publicar el frontend
que usa los enlaces. Comprueba en **Authentication → URL Configuration** que el origen
y la ruta de GitHub Pages se admiten para la confirmación de correo y prueba un alta
desde un enlace con el parámetro `campaign`.

## 2. Importar una campaña existente, si la hay

El exportador de SQLite se ejecuta sobre el esquema anterior a multicampaña, antes
de las dos migraciones de aislamiento. Para trasladar datos reales hacen falta una copia
de `campaign.db`, el árbol `uploads/` y la correspondencia de jugadores y correos. En una
copia privada de SQLite ejecuta primero las 14 migraciones de FastAPI. Mantén el backend anterior
disponible y detén las escrituras durante la última copia para evitar perder cambios.

1. Crea en Supabase Auth una cuenta por jugador, con su correo real y su nombre visible
   original. Si creas cuentas desde el panel de Supabase, ajusta `public.profiles.username`
   al nombre original utilizando el UUID verificado. Los hashes de SQLite quedan en el
   respaldo. Distribuye credenciales nuevas o confirma las cuentas con su propietario.
2. Prepara un archivo JSON privado con el ID numérico antiguo como clave y el UUID real
   de Auth como valor, por ejemplo `{"1":"4ea77bcf-b1b3-4cec-99eb-b2e88daa2d75"}`.
   Ejecuta el exportador con Python 3.11 o posterior.

   ```sh
   python supabase/scripts/export_sqlite.py /ruta/campaign.db /ruta/uploads /ruta/usuarios.json /ruta/exportacion-privada
   ```

3. Revisa `counts.json`. Sube el **contenido** de `objects/` a `campaign-files` con un
   operador de Storage. Conserva cada ruta, por ejemplo `maps/1/archivo.png`. Con la CLI,
   copia cada carpeta existente de `objects/` a su prefijo del mismo nombre, por ejemplo
   `supabase storage cp --experimental --linked -r /ruta/exportacion-privada/objects/maps ss:///campaign-files/maps`.
   Comprueba la ruta final en Storage antes de importar el SQL. Si falta un archivo o su
   formato no está admitido, el exportador señala el registro para resolverlo antes del corte.
4. Ejecuta `import.sql` en una conexión PostgreSQL de administrador, por ejemplo,
   `psql -v ON_ERROR_STOP=1 -f /ruta/exportacion-privada/import.sql` con la conexión
   configurada fuera del repositorio. La transacción exige que las tablas de campaña estén
   vacías y que los perfiles existan con el nombre esperado. Conserva los IDs de datos,
   reasigna los propietarios a Auth y ajusta las secuencias. Comprueba los recuentos,
   el acceso de cada jugador y las descargas antes de publicar.

El bucket admite PDF para fichas y las imágenes PNG, JPEG, WebP, GIF, AVIF, BMP y TIFF.
El tamaño máximo por archivo es de 50 MB, sujeto al límite global del proyecto. Las URLs
firmadas caducan a los 15 minutos y la aplicación actualiza las listas mientras está abierta.
Si una subida se interrumpe entre Storage y PostgreSQL, un operador de Storage puede retirar
objetos huérfanos después de comprobar que ninguna fila los referencia. El exportado, el SQLite
y sus archivos contienen datos de campaña y deben almacenarse fuera del repositorio.

## 3. GitHub Pages

1. En **Settings → Secrets and variables → Actions → Variables**, crea
   `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Usa
   `https://mldgsloebfpxciozyyyo.supabase.co` y la clave `sb_publishable_…` de Supabase.
   Vite incluye esos dos valores en el sitio. Usa solo la clave publicable.
2. En **Settings → Pages**, selecciona **GitHub Actions** como fuente de publicación.
3. Tras validar Supabase e importar los datos si corresponde, fusiona la PR. El workflow
   compila las PR y publica solo compilaciones de `main`. Prueba
   `https://karshkin.github.io/dnd-campaing-tracker/` y una ruta de sección tras recargar
   la página. La navegación por hash conserva la base del sitio.
4. Confirma altas, inicio y cierre de sesión, jugadores, permisos, datos y archivos con
   cuentas de prueba. Conserva la copia de SQLite y FastAPI hasta validar la publicación.

El despliegue usa los servicios gratuitos de Pages y Supabase dentro de sus cuotas.
Comprueba tamaño de Storage, transferencia, usuarios y correo del proyecto antes de mover
los archivos reales.

## 4. Validación local reproducible

Con Docker y la CLI de Supabase disponibles, ejecuta `supabase start` desde la raíz. La
configuración local inicia el proyecto de prueba con confirmación de correo desactivada,
para que el test pueda registrar cuentas automáticamente. Para la prueba, toma la URL y
las claves **locales** de `supabase status` y ejecuta:

```sh
cd frontend
npm ci
VITE_SUPABASE_URL=http://127.0.0.1:54321 \
VITE_SUPABASE_PUBLISHABLE_KEY=<clave-local-anon-o-publicable> \
TRACKER_TEST_SERVICE_KEY=<clave-local-service_role> \
npm run test:supabase
```

El test usa un proyecto local desechable. Comprueba registro, sesión, administración,
persistencia, CRUD, propiedad de los personajes y acceso a Storage. Comprueba además
desde la URL de Pages el flujo de confirmación con SMTP, porque ese recorrido depende de
la configuración del proyecto alojado.

## Crónica, reputación y tesoro grupal

Antes de publicar el frontend de la issue #21, revisa y aplica
`20261127230127_campaign_chronicle_reputation_treasury.sql` en una copia de
preproducción. Haz una copia de la base de datos y de Storage, verifica la aplicación
en dos campañas y coordina la aplicación de la migración en producción antes de
fusionar la PR que publica GitHub Pages.

- La crónica añade capítulos, sesiones y misiones. Las entradas anteriores siguen
  accesibles en **Entradas del diario** y participan en la búsqueda. Las hojas de
  personaje conservan sus diarios personales. Las notas del director se guardan en
  una tabla separada y permanecen privadas después de publicar o cerrar.
- El director puede publicar un resumen y completar el cierre después. El cierre
  publica la sesión y aplica todo el reparto de botín y los cambios de reputación,
  misiones y alineamiento de PNJ en una transacción. Una repetición del cierre de
  una sesión cerrada mantiene el resultado de la primera ejecución.
- La reputación empieza neutral en cada par de organización y grupo. Los jugadores
  con acceso a Organizaciones y al grupo reciben solo la reputación visible y su
  historial autorizado. Los ajustes se saturan en ±100 y el historial conserva la
  diferencia solicitada y el valor aplicado.
- Las aportaciones se conservan con su ID, cantidad y autor. Se pueden transferir
  al inventario de un personaje usando el tesoro grupal. Las aportaciones monetarias
  históricas tienen nombres libres y se conservan en **Monedas (legado)**. El
  monedero de cinco denominaciones registra movimientos estructurados desde cero.
- El tesoro admite miembros del grupo y directores de la campaña. Los jugadores
  transfieren a sus propios personajes con permiso de edición. El director puede
  repartir a personajes de participantes del grupo. Los movimientos se serializan por
  campaña y se registran en la misma transacción que modifica el saldo. El cliente
  reusa el ID de la solicitud al reintentar un mismo envío.
- La portada y la galería usan el bucket privado `chronicle-images`. Inclúyelo en
  las copias de Storage y comprueba que una cuenta ajena a la campaña no pueda
  generar URLs firmadas. El editor admite un conjunto acotado de etiquetas de
  formato y sanitiza cada resumen antes de guardarlo y de renderizarlo.

El repositorio aún carece de un gestor de encuentros. Cuando exista, añade una
referencia opcional `encounter_id` a `chronicle_links` y a `treasury_history` con
claves foráneas compuestas por campaña e ID. Amplía las políticas de lectura para
exigir acceso al encuentro, la validación de los RPC y los formularios. El cierre
ya recibe el ID de sesión y pasa por la misma función de movimientos que el tesoro.
Las referencias a PNJ usan `allies`, mientras las del bestiario usan `creatures`.

Para comprobar una instalación local, carga las claves de la salida de
`supabase status` en `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` y
`TRACKER_TEST_SERVICE_KEY`. Desde `frontend` ejecuta `npm ci`, `npm run build`,
`npm run test:supabase`, `npx playwright install chromium` y
`npm run test:chronicle`. Puedes usar un Chromium del sistema configurando
`TRACKER_TEST_CHROMIUM`.

Para comprobar la conservación de datos, prepara una base local desechable
hasta `20261127165548` con `supabase db reset --local --version 20261127165548`
y ejecuta `psql "$LOCAL_DATABASE_URL" -f supabase/tests/chronicle_upgrade.sql`.
La prueba agrega datos anteriores, aplica la migración y comprueba los registros
y la reputación inicial dentro de una transacción que revierte al terminar.

### Pestañas y acceso privado

Publica primero el frontend que separa **Localizaciones y mapas**, **Crónica de
aventuras**, **Inventario grupal** y **Recursos**. Después aplica
`20261127233057_private_campaign_registration.sql` para retirar el permiso de
ejecución del RPC que devolvía el nombre de campaña durante el registro. Ese orden
mantiene operativo el registro por invitación durante el despliegue. Auth sigue
validando el enlace y asignando la membresía al crear la cuenta.

Comprueba que los enlaces directos a pestañas muestran el formulario de acceso sin
sesión, que el formulario de registro funciona con una invitación vigente y que las
cuentas sin membresía solo ven las campañas a las que tienen acceso.
