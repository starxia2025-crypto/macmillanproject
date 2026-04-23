# Soporte Macmillan

Esta iteracion adapta el proyecto a un escenario real de soporte educativo para Macmillan.

## Cambios implementados

- Rebranding principal a `Soporte Macmillan`
- Nuevo rol `manager` para acceso a estadisticas
- Nueva base de formulario para incidencias educativas:
  - colegio
  - correo del informador
  - consulta sobre alumno/docente
  - matricula
  - etapa
  - curso
  - asignatura
  - tipo de consulta
  - descripcion
  - observaciones
- Vista `/admin` como backoffice tecnico inicial
- Base de datos preparada con tabla `schools`

## Arquitectura objetivo

El objetivo de negocio es evolucionar hacia:

- una misma base de datos MySQL
- un esquema logico por cliente o grupo educativo
- datos operativos separados por cliente
- operacion centralizada del equipo tecnico de Macmillan

En esta iteracion se mantiene la logica actual por `tenantId` para no romper el sistema existente, pero se deja preparado el terreno para:

- anadir `dbSchema` por cliente
- gestionar colegios dependientes de un cliente principal
- separar mas tarde consultas, documentos y configuraciones por esquema

## Proximos modulos recomendados

### 1. Correo transaccional

- aviso al equipo tecnico al crear incidencia
- confirmacion al usuario al cerrar o resolver ticket
- plantillas por cliente

### 2. Gestion real de colegios

- CRUD de colegios en `/admin`
- jerarquia colegio central / colegios asociados
- filtros y estadisticas por colegio

### 3. Exportacion e informes

- exportacion CSV/XLSX
- informes por rango de fechas
- resumenes por colegio, etapa, asignatura y tipo de consulta

### 4. Estadisticas avanzadas

- distribucion por colegio
- distribucion por etapa educativa
- tiempos medios de resolucion por colegio
- reparto por profesor o informador

### 5. Accesos rapidos de cliente

- enlaces configurables por tenant
- accesos a plataformas Macmillan
- portal personalizado por cliente
