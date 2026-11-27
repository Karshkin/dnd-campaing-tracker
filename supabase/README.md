# Migración a Supabase y publicación en GitHub Pages

Proyecto previsto: `mldgsloebfpxciozyyyo`. La aplicación usa Auth, PostgreSQL 17,
Storage privado y una Edge Function para la administración de cuentas. Usa Node.js 24 para
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
   La creación desde el panel confirma la cuenta al provisionarla. Entrega sus credenciales
   iniciales directamente a la persona destinataria.
4. Despliega `supabase functions deploy manage-users --project-ref mldgsloebfpxciozyyyo`.
   La configuración de la función desactiva la verificación JWT del gateway. La función valida
   el token con Supabase Auth y consulta los permisos vigentes en PostgreSQL antes de cada
   operación. Usa los secretos estándar `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
   `SUPABASE_SERVICE_ROLE_KEY` en el entorno de la función. Las credenciales del servidor se
   mantienen en Supabase.

### Crear el primer administrador

Registra una cuenta con el correo del responsable o créala en **Authentication → Users**.
Si la creas desde el panel de Supabase, el perfil se inicia con un nombre temporal. Comprueba
la identidad de la cuenta y copia el UUID que muestra Auth. Ejecuta en el editor SQL con
el rol administrador y verifica que haya devuelto exactamente el perfil esperado.

```sql
update public.profiles
set username = 'Nombre visible del responsable', is_admin = true
where id = '<UUID verificado en Authentication → Users>'::uuid
returning id, username, is_admin;
```

Inicia sesión con el correo y abre `/#/admin` desde la aplicación. Los permisos de sección
`none`, `view`, `edit` y `admin` se gestionan allí. Un administrador de la sección de
administración puede gestionar jugadores y sus permisos. Solo un administrador global puede
cambiar la contraseña de otro administrador global. Un administrador global también puede consultar los personajes y diarios de todos los
jugadores en la sección de personajes. Solo sus propietarios pueden editarlos y acceder
a sus inventarios y archivos adjuntos.

## 2. Importar una campaña existente, si la hay

La migración prepara un esquema vacío. Para trasladar datos reales hacen falta una copia
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
