# Despliegue Empresa en Ubuntu 24.04

Guia operativa concisa para desplegar este proyecto en un servidor Ubuntu 24.04 con:

- frontend y backend en la VPS
- MySQL en un servidor aparte
- Nginx en `80/443`
- un unico subdominio publico, por ejemplo `premac.starxia.com`

## 1. Sistema

```bash
ssh root@IP_VPS

apt update && apt upgrade -y
apt install -y nginx mysql-client git curl unzip build-essential ufw certbot python3-certbot-nginx rsync

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status
```

Comprobaciones:

```bash
nginx -v
mysql --version
git --version
curl --version
unzip -v
dpkg -s build-essential | grep Status
ufw --version
```

## 2. Usuario de despliegue

```bash
adduser deploy
usermod -aG sudo deploy
usermod -aG www-data deploy
su - deploy
groups
```

Debe aparecer `sudo` y `www-data`.

## 3. Node 24 y pnpm

Ejecutar como `deploy`:

```bash
cd ~
export NVM_DIR="$HOME/.nvm"
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
. "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24
corepack enable
corepack prepare pnpm@latest --activate

which node
node -v
pnpm -v
```

Guardar la ruta de `node`. Se usara en `systemd`.

## 4. Clonar el repo

```bash
cd /home/deploy
git clone https://github.com/starxia2025-crypto/macmillanproject.git
cd macmillanproject
git checkout main
git config --global --add safe.directory /home/deploy/macmillanproject
pnpm install
```

Si el repo tiene propietario incorrecto:

```bash
sudo chown -R deploy:deploy /home/deploy/macmillanproject
```

## 5. Carpetas runtime

```bash
sudo mkdir -p /var/www/premac/current
sudo mkdir -p /var/www/premac/storage/documents
sudo chown -R deploy:www-data /var/www/premac
sudo chmod -R 775 /var/www/premac
```

## 6. Datos necesarios del MySQL remoto

Antes de seguir, necesitas:

- `MYSQL_HOST`: host o IP del MySQL remoto
- `MYSQL_PORT`: normalmente `3306`
- `MYSQL_DATABASE`: nombre de la base de datos
- `MYSQL_USER`: usuario de la aplicacion
- `MYSQL_PASSWORD`: contrasena del usuario
- confirmacion de que la IP de esta VPS puede conectarse al MySQL remoto

Prueba de conexion:

```bash
mysql -h MYSQL_HOST -P 3306 -u MYSQL_USER -p
```

## 7. Variables de entorno

```bash
cd /home/deploy/macmillanproject
nano .env.local
```

Contenido base:

```env
NODE_ENV=production
PORT=3001

FRONTEND_URL=https://premac.starxia.com/
VITE_API_BASE_URL=https://premac.starxia.com
BASE_PATH=/

DOCUMENTS_STORAGE_ROOT=/var/www/premac/storage

DATABASE_URL=mysql://MYSQL_USER:MYSQL_PASSWORD@MYSQL_HOST:3306/MYSQL_DATABASE
MYSQL_HOST=MYSQL_HOST
MYSQL_PORT=3306
MYSQL_DATABASE=MYSQL_DATABASE
MYSQL_USER=MYSQL_USER
MYSQL_PASSWORD=MYSQL_PASSWORD
MYSQL_CONNECTION_LIMIT=10
MYSQL_CHARSET=utf8mb4

SESSION_SECRET=GENERAR_SECRETO_LARGO
CAPTCHA_SECRET=GENERAR_OTRO_SECRETO_LARGO

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

### Que significa cada variable

- `FRONTEND_URL`: URL publica de la aplicacion
- `VITE_API_BASE_URL`: URL publica base usada por el frontend para llamar a la API
- `BASE_PATH`: ruta base de la SPA, normalmente `/`
- `DOCUMENTS_STORAGE_ROOT`: carpeta local donde se guardan los ficheros subidos
- `DATABASE_URL`: cadena completa de conexion a MySQL
- `MYSQL_HOST`: host o IP del servidor MySQL remoto
- `MYSQL_PORT`: puerto MySQL
- `MYSQL_DATABASE`: nombre de la base de datos
- `MYSQL_USER`: usuario de la aplicacion
- `MYSQL_PASSWORD`: contrasena del usuario
- `SESSION_SECRET`: secreto interno para sesiones
- `CAPTCHA_SECRET`: secreto interno adicional
- `MICROSOFT_CLIENT_ID`: si se usa login Microsoft, sale del registro de app en Azure
- `MICROSOFT_CLIENT_SECRET`: secreto del registro Azure
- `MICROSOFT_TENANT_ID`: `common` o el tenant real
- `MICROSOFT_REDIRECT_URI`: callback configurada en Azure
- `EXTERNAL_INTEGRATION_API_KEY`: clave obligatoria para autenticar el servicio externo que envia tickets
- `EXTERNAL_INTEGRATION_TENANT_ID`: tenant destino donde se crearan esos tickets
- `EXTERNAL_INTEGRATION_SCHOOL_ID`: colegio destino opcional; si se informa, debe pertenecer al tenant configurado
- `EXTERNAL_INTEGRATION_FALLBACK_USER_ID`: usuario tecnico o de servicio que figurara como creador si `reporterEmail` no existe

Generar secretos:

```bash
openssl rand -hex 32
```

### Integracion externa de tickets

La recepcion de tickets externos queda publicada en:

```text
POST /api/integrations/external
```

Requisitos:

- cabecera `x-api-key` con el valor de `EXTERNAL_INTEGRATION_API_KEY`
- `EXTERNAL_INTEGRATION_TENANT_ID` configurado
- `EXTERNAL_INTEGRATION_FALLBACK_USER_ID` recomendado para asegurar un creador valido

Ejemplo:

```bash
curl -X POST "https://premac.starxia.com/api/integrations/external" \
  -H "Content-Type: application/json" \
  -H "x-api-key: TU_API_KEY" \
  -d '{
    "externalId": "ext-123",
    "type": "email_change",
    "reporterEmail": "origen@cliente.com",
    "affectedEmail": "usuario@dominio.com",
    "newEmail": "usuario.nuevo@dominio.com",
    "orderId": "PED-001",
    "title": "Cambio de correo",
    "description": "Solicitud recibida desde sistema externo para cambiar correo.",
    "reason": "Cuenta duplicada"
  }'
```

## 8. Crear tablas

```bash
cd /home/deploy/macmillanproject
pnpm --filter @workspace/db run push
mysql -h MYSQL_HOST -P 3306 -u MYSQL_USER -pMYSQL_PASSWORD -D MYSQL_DATABASE -e "SHOW TABLES;"
```

Deben aparecer al menos:

- `SOP_users`
- `SOP_tenants`
- `SOP_tickets`
- `SOP_comments`
- `SOP_documents`
- `SOP_sessions`
- `SOP_schools`
- `SOP_audit_logs`
- `SOP_system_alerts`

## 9. Crear admin inicial

```bash
cd /home/deploy/macmillanproject
export SEED_SUPERADMIN_EMAIL=admin@starxia.com
export SEED_SUPERADMIN_PASSWORD='CAMBIA_ESTA_PASSWORD'
export SEED_SUPERADMIN_NAME='Administrador Principal'
export SEED_TENANT_NAME='Tenant Principal'
export SEED_TENANT_SLUG='principal'
pnpm --filter @workspace/scripts run seed:admin
```

Comprobacion:

```bash
mysql -h MYSQL_HOST -P 3306 -u MYSQL_USER -pMYSQL_PASSWORD -D MYSQL_DATABASE -e "SELECT id,email,role,active FROM SOP_users;"
```

## 10. Build

```bash
cd /home/deploy/macmillanproject
pnpm --filter @workspace/helpdesk run build
pnpm --filter @workspace/api-server run build
```

## 11. Publicar frontend

```bash
sudo rsync -av --delete /home/deploy/macmillanproject/artifacts/helpdesk/dist/public/ /var/www/premac/current/
sudo chown -R www-data:www-data /var/www/premac/current
```

## 12. Servicio systemd del backend

Sacar la ruta real de `node`:

```bash
which node
```

Crear el servicio:

```bash
sudo nano /etc/systemd/system/premac-backend.service
```

Contenido:

```ini
[Unit]
Description=Premac Backend
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/macmillanproject
EnvironmentFile=/home/deploy/macmillanproject/.env.local
ExecStart=/home/deploy/.nvm/versions/node/v24.15.0/bin/node --enable-source-maps /home/deploy/macmillanproject/artifacts/api-server/dist/index.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Activar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable premac-backend
sudo systemctl restart premac-backend
sudo systemctl status premac-backend --no-pager
curl http://127.0.0.1:3001/api/healthz
```

Debe devolver:

```json
{"status":"ok"}
```

## 13. Nginx

```bash
sudo nano /etc/nginx/sites-available/premac.starxia.com
```

Contenido:

```nginx
server {
    listen 80;
    server_name premac.starxia.com;

    root /var/www/premac/current;
    index index.html;

    location /uploads/ {
        alias /var/www/premac/storage/;
        access_log off;
        expires 7d;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Activar:

```bash
sudo ln -s /etc/nginx/sites-available/premac.starxia.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl status nginx --no-pager
```

## 14. SSL

```bash
sudo certbot --nginx -d premac.starxia.com
systemctl status certbot.timer
```

## 15. Comprobacion final

```bash
systemctl is-active nginx
systemctl is-active premac-backend
curl http://127.0.0.1:3001/api/healthz
curl https://premac.starxia.com/api/healthz
```

Debe salir:

- `active`
- `active`
- `{"status":"ok"}`
- `{"status":"ok"}`

## 16. Actualizar despliegue

```bash
cd /home/deploy/macmillanproject
git pull origin main
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/helpdesk run build
pnpm --filter @workspace/api-server run build
sudo rsync -av --delete /home/deploy/macmillanproject/artifacts/helpdesk/dist/public/ /var/www/premac/current/
sudo systemctl restart premac-backend
sudo systemctl reload nginx
```

## 17. Errores tipicos

`dubious ownership`:

```bash
git config --global --add safe.directory /home/deploy/macmillanproject
sudo chown -R deploy:deploy /home/deploy/macmillanproject
```

Nginx no arranca:

```bash
ss -tulpn | grep :80
ss -tulpn | grep :443
nginx -t
```

Backend no arranca:

```bash
sudo systemctl status premac-backend --no-pager
journalctl -u premac-backend -n 100 --no-pager
```

`healthz` falla:

```bash
pnpm --filter @workspace/db run push
sudo systemctl restart premac-backend
```
