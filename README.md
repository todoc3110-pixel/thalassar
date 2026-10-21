# Thalassar

## Avisos de estado del servidor de ARK

El monitor consulta la API de Nitrado cada cinco minutos mediante GitHub Actions
y envía un mensaje al webhook de Discord cuando detecta un cambio entre
`stopped` y `started`. GitHub Actions ejecuta estos jobs gratis en este
repositorio público; la hora exacta puede retrasarse por la programación de
GitHub.

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

El primer sondeo guarda el estado actual como referencia y no envía un aviso.
Los siguientes sondeos avisan al detectar que el servidor pasó de detenido a
encendido o de encendido a detenido. Si ahora está encendido, el primer sondeo
debe registrar ese estado antes de que el próximo apagado genere un aviso. La
página consulta `/api/server-status` y muestra el estado guardado con un
indicador rojo/verde, actualizado desde Redis cada minuto. El valor puede tener
hasta unos minutos de retraso entre sondeos.

No coloques credenciales en el HTML, en `.env.example` ni en commits. Si una
credencial fue compartida, revócala y configura una nueva.
