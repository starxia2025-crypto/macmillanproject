# Despliegue PRE en Ubuntu 24.04

Esta guia deja el proyecto preparado para un entorno `pre` auditable en una VPS Ubuntu 24.04, con MySQL como unico motor de base de datos y un unico subdominio publico:

- `https://premac.starxia.com`

La arquitectura prevista es:

- `Nginx` como proxy inverso y servidor del frontend compilado
- `Node.js` para el backend API
- `MySQL` en la misma VPS
- un unico dominio publico con proxy hacia el backend y frontend

## 1. Componentes del proyecto

- Frontend: `artifacts/helpdesk`
- Backend: `artifacts/api-server`
- Base de datos: MySQL

El backend puede servir la SPA si defines `STATIC_DIR`, pero para Ubuntu 24.04 se recomienda:

- `Nginx` sirviendo el frontend compilado
- `Nginx` haciendo proxy de `/api` al backend Node
- `Nginx` sirviendo `/uploads` desde el almacenamiento persistente

## 2. Archivos relevantes del repo

- `Dockerfile.web`
- `Dockerfile.api`
- `docker/nginx/web.conf`
- `.dockerignore`
- `artifacts/api-server/.env.example`
- `.env.local.example`

## 3. Variables de entorno recomendadas para PRE

Backend:

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=mysql://MYSQL_USER:MYSQL_PASSWORD@127.0.0.1:3306/MYSQL_DATABASE
FRONTEND_URL=https://premac.starxia.com/
DOCUMENTS_STORAGE_ROOT=/var/www/premac/storage
SESSION_SECRET=CAMBIA_ESTE_VALOR
CAPTCHA_SECRET=CAMBIA_ESTE_VALOR
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=https://premac.starxia.com/api/auth/microsoft/callback
TICKET_RESOLVED_NOTIFY_TO=
STATIC_DIR=
EXTERNAL_INTEGRATION_API_KEY=GENERAR_CLAVE_LARGA_ALEATORIA
EXTERNAL_INTEGRATION_TENANT_ID=
EXTERNAL_INTEGRATION_SCHOOL_ID=
EXTERNAL_INTEGRATION_FALLBACK_USER_ID=
EXTERNAL_INTEGRATION_FALLBACK_USER_EMAIL=
```

Frontend build:

```env
PORT=4173
BASE_PATH=/
VITE_API_BASE_URL=https://premac.starxia.com
```

MySQL:

```env
MYSQL_DATABASE=MYSQL_DATABASE
MYSQL_USER=MYSQL_USER
MYSQL_PASSWORD=MYSQL_PASSWORD
MYSQL_ROOT_PASSWORD=MYSQL_ROOT_PASSWORD
```

## 4. Crear o sincronizar el esquema

El proyecto usa Drizzle con MySQL. Para aplicar el esquema:

```bash
pnpm --filter @workspace/db run push
```

Ese comando debe ejecutarse con `DATABASE_URL` apuntando a la base MySQL del entorno `pre`.

## 5. Crear el primer superadmin

Desde la terminal del backend:

```bash
export SEED_SUPERADMIN_EMAIL=admin@tudominio.com
export SEED_SUPERADMIN_PASSWORD='CambiaEsto123!'
export SEED_SUPERADMIN_NAME='Administrador Principal'
export SEED_TENANT_NAME='Tenant Principal'
export SEED_TENANT_SLUG='principal'
pnpm --filter @workspace/scripts run seed:admin
```

## 6. Validaciones rapidas

Backend:

```text
https://premac.starxia.com/api/healthz
```

Frontend:

```text
https://premac.starxia.com
```

## 7. Notas

- `MOC_Mochilas` debe existir en la misma base MySQL del proyecto.
- El frontend consume la API por `VITE_API_BASE_URL`; no debe depender de `localhost` en `pre`.
- El codigo de Electron puede seguir existiendo en el repo, pero no forma parte del despliegue web normal en Ubuntu 24.04.
