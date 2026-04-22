# Deploy en EasyPanel

Esta guia deja el proyecto preparado para desplegarse en EasyPanel con MySQL como motor unico.

Servicios existentes en la VPS:

- `helpdesk-api`
- `helpdesk-web`
- `heldeoskmac`

Asumo lo siguiente porque los nombres parecen invertidos:

- `helpdesk-api` se usara como servicio del frontend web
- `helpdesk-web` se usara como servicio del backend API
- `heldeoskmac` es el servicio MySQL interno

No renombro esos servicios; solo adapto la guia a esa convencion.

## 1. Estructura de despliegue

- Frontend: `artifacts/helpdesk`
- Backend: `artifacts/api-server`
- Base de datos: MySQL en `heldeoskmac`

El backend puede servir la SPA si defines `STATIC_DIR`, pero para EasyPanel recomiendo mantener frontend y backend como servicios separados.

## 2. Dockerfiles del repo

Archivos listos para usar:

- `Dockerfile.web`
- `Dockerfile.api`
- `docker/nginx/web.conf`
- `.dockerignore`

## 3. Servicio MySQL

Usa el servicio existente `heldeoskmac` como host interno de red.

La conexion recomendada es:

```env
DATABASE_URL=mysql://MYSQL_USER:MYSQL_PASSWORD@heldeoskmac:3306/MYSQL_DATABASE
```

Si prefieres variables separadas, usa:

```env
MYSQL_HOST=heldeoskmac
MYSQL_PORT=3306
MYSQL_DATABASE=MYSQL_DATABASE
MYSQL_USER=MYSQL_USER
MYSQL_PASSWORD=MYSQL_PASSWORD
MYSQL_CONNECTION_LIMIT=10
MYSQL_CHARSET=utf8mb4
```

## 4. Servicio backend: `helpdesk-web`

Configura este servicio con:

- Dockerfile path: `Dockerfile.api`
- Puerto interno: `3001`

Variables minimas:

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=mysql://MYSQL_USER:MYSQL_PASSWORD@heldeoskmac:3306/MYSQL_DATABASE
FRONTEND_URL=https://TU_FRONTEND_URL/
DOCUMENTS_STORAGE_ROOT=/app/storage
SESSION_SECRET=CAMBIA_ESTE_VALOR
CAPTCHA_SECRET=CAMBIA_ESTE_VALOR
```

Opcionales:

```env
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=https://TU_BACKEND_URL/api/auth/microsoft/callback
OPENAI_API_KEY=
TICKET_RESOLVED_NOTIFY_TO=
STATIC_DIR=
```

Health check:

```text
/api/healthz
```

## 5. Servicio frontend: `helpdesk-api`

Configura este servicio con:

- Dockerfile path: `Dockerfile.web`
- Puerto interno: `80`

Build args:

```env
PORT=4173
BASE_PATH=/
VITE_API_BASE_URL=https://TU_BACKEND_URL
```

Salida de build:

- carpeta generada: `artifacts/helpdesk/dist/public`
- fichero principal: `artifacts/helpdesk/dist/public/index.html`

## 6. Crear o sincronizar el esquema

El proyecto usa Drizzle con MySQL. Para aplicar el esquema:

```bash
pnpm --filter @workspace/db run push
```

Ese comando debe ejecutarse con `DATABASE_URL` apuntando a `heldeoskmac`.

## 7. Crear el primer superadmin

Desde la terminal del backend:

```bash
export SEED_SUPERADMIN_EMAIL=admin@tudominio.com
export SEED_SUPERADMIN_PASSWORD='CambiaEsto123!'
export SEED_SUPERADMIN_NAME='Administrador Principal'
export SEED_TENANT_NAME='Tenant Principal'
export SEED_TENANT_SLUG='principal'
pnpm --filter @workspace/scripts run seed:admin
```

## 8. Orden recomendado de despliegue

1. `heldeoskmac`
2. `helpdesk-web`
3. `helpdesk-api`

## 9. Variables por servicio

### `helpdesk-web`

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=mysql://MYSQL_USER:MYSQL_PASSWORD@heldeoskmac:3306/MYSQL_DATABASE
FRONTEND_URL=https://TU_FRONTEND_URL/
DOCUMENTS_STORAGE_ROOT=/app/storage
SESSION_SECRET=CAMBIA_ESTE_VALOR
CAPTCHA_SECRET=CAMBIA_ESTE_VALOR
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=https://TU_BACKEND_URL/api/auth/microsoft/callback
OPENAI_API_KEY=
TICKET_RESOLVED_NOTIFY_TO=
STATIC_DIR=
```

### `helpdesk-api`

Build args:

```env
PORT=4173
BASE_PATH=/
VITE_API_BASE_URL=https://TU_BACKEND_URL
```

### `heldeoskmac`

Los valores reales dependen de como hayas creado el servicio, pero necesitas:

```env
MYSQL_DATABASE=MYSQL_DATABASE
MYSQL_USER=MYSQL_USER
MYSQL_PASSWORD=MYSQL_PASSWORD
MYSQL_ROOT_PASSWORD=MYSQL_ROOT_PASSWORD
```

## 10. Validaciones rapidas

Backend:

```text
https://TU_BACKEND_URL/api/healthz
```

Frontend:

```text
https://TU_FRONTEND_URL
```

## 11. Notas

- No queda prevista ninguna conexion secundaria a SQL Server.
- `MOC_Mochilas` debe existir en la misma base MySQL del proyecto.
- El frontend consume la API por `VITE_API_BASE_URL`; no debe depender de `localhost`.
- El codigo de Electron puede seguir existiendo en el repo, pero no forma parte del despliegue web normal en EasyPanel.
