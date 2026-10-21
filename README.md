# Thalassar

## Avisos de estado del servidor de ARK

El monitor consulta Nitrado cada cinco minutos mediante GitHub Actions y envía
un nuevo informe a Discord en cada consulta, además de indicar los cambios entre
`stopped` y `started`. Esto puede generar hasta 288 mensajes al día. GitHub
Actions ejecuta estos jobs gratis en este repositorio público; la hora exacta
puede retrasarse por la programación de GitHub.

### Configuración en Vercel

Agrega estas variables en **Project Settings → Environment Variables** y
despliega de nuevo:

- `NITRADO_API_TOKEN`: token de acceso Bearer de la API de Nitrado. Un App ID y
  App Secret por sí solos no son un token de acceso.
- `NITRADO_SERVICE_ID`: ID del servicio de Nitrado (no la IP ni el puerto).
- `DISCORD_WEBHOOK_URL`: webhook del canal correcto. Manténlo secreto.
- `MONITOR_SECRET`: secreto aleatorio compartido con GitHub Actions.
- Credenciales REST de Upstash/Vercel KV: `KV_REST_API_URL` y
  `KV_REST_API_TOKEN`, o `UPSTASH_REDIS_REST_URL` y
  `UPSTASH_REDIS_REST_TOKEN`.

Para encontrar el ID del servicio, consulta `GET https://api.nitrado.net/services`
con el token Bearer y busca el servidor por `data.services[].details.address`;
usa el valor `id` de ese servicio.

### Configuración en GitHub

En **Settings → Secrets and variables → Actions**, agrega:

- `MONITOR_URL`: URL base de producción de Vercel, sin una barra final.
- `MONITOR_SECRET`: el mismo valor configurado en Vercel.
- `NITRADO_API_TOKEN`: el mismo token Bearer de Nitrado configurado en Vercel.
- `NITRADO_SERVICE_ID`: el ID del servicio configurado en Vercel.

Cada informe incluye estado, región, mapa, jugadores conectados, capacidad,
ping y tiempo de conexión por jugador cuando la consulta A2S de ARK responde.
Si la consulta del juego no está disponible, esos valores se mostrarán como no
disponibles. El tiempo activo empieza a contarse desde el primer sondeo que
detecta al servidor encendido, por lo que al instalar el monitor es aproximado.
El primer sondeo guarda el estado como referencia; los siguientes también
indican los cambios detectados. La página consulta `/api/server-status` y
muestra el estado guardado con un indicador rojo/verde, actualizado desde Redis
cada minuto.

No coloques credenciales en el HTML, en `.env.example` ni en commits. Si una
credencial fue compartida, revócala y configura una nueva.
