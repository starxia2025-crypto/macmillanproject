# HelpDesk Pro

## Overview

A full-stack multitenant support platform that replaces SharePoint + Microsoft Forms + Microsoft Lists + Power Automate for educational technology companies. Built as a pnpm monorepo with TypeScript throughout.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/helpdesk)
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- **Build**: esbuild (CJS bundle)
- **Auth**: Cookie-based sessions with bcryptjs
- **Charts**: Recharts

## Default Credentials

| Email | Password | Role |
|---|---|---|
| admin@helpdesk.es | Admin1234! | superadmin |
| tecnico@helpdesk.es | Tech1234! | tecnico |
| tecnico2@helpdesk.es | Tech1234! | tecnico |
| admin@consignas.es | Tech1234! | admin_cliente (Consignas) |
| usuario@consignas.es | User1234! | usuario_cliente (Consignas) |
| admin@educare.es | Tech1234! | admin_cliente (Educare) |
| usuario@educare.es | User1234! | usuario_cliente (Educare) |

## Tenants (Clients)

- **Consignas EdTech** (slug: consignas) — educational content activation platform
- **Educare Schools** (slug: educare) — school management platform

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── helpdesk/          # React + Vite frontend (preview at /)
│   └── api-server/        # Express 5 API server (preview at /api)
├── lib/
│   ├── api-spec/          # OpenAPI 3.1 spec + Orval codegen config
│   ├── api-client-react/  # Generated React Query hooks
│   ├── api-zod/           # Generated Zod schemas
│   └── db/                # Drizzle ORM schema + DB connection
└── scripts/               # Utility scripts
```

## Database Schema

- **tenants** — Client/tenant organizations
- **users** — Platform users with RBAC roles
- **sessions** — Auth sessions (cookie-based)
- **tickets** — Support tickets with multitenant isolation
- **comments** — Ticket comments (internal/external differentiated)
- **documents** — Knowledge base documents per tenant
- **audit_logs** — Full audit trail of all actions

## Roles

- **superadmin** — Full platform access
- **admin_cliente** — Tenant admin (own tenant only)
- **tecnico** — Technical support team
- **usuario_cliente** — End user (own tickets + portal)
- **visor_cliente** — Read-only access (portal only)

## API Routes

All routes under `/api/`:

- `POST /auth/login` — Login with email/password
- `POST /auth/logout` — Logout
- `GET /auth/me` — Get current user
- `GET/POST /tenants` — List/create tenants
- `GET/PATCH /tenants/:id` — Get/update tenant
- `GET/POST /users` — List/create users
- `GET/PATCH /users/:id` — Get/update user
- `GET/POST /tickets` — List/create tickets (tenant-isolated)
- `GET/PATCH /tickets/:id` — Get/update ticket
- `POST /tickets/:id/assign` — Assign ticket
- `POST /tickets/:id/status` — Change ticket status
- `GET/POST /tickets/:id/comments` — Comments
- `GET/POST /documents` — Document portal (role-filtered)
- `GET/PATCH/DELETE /documents/:id` — Document management
- `GET /dashboard/stats` — KPI statistics
- `GET /dashboard/tickets-by-status` — Status breakdown
- `GET /dashboard/tickets-by-priority` — Priority breakdown
- `GET /dashboard/tickets-over-time` — Time series
- `GET /dashboard/tickets-by-technician` — Technician workload
- `GET /dashboard/recent-activity` — Activity feed
- `GET /dashboard/top-categories` — Top ticket categories
- `GET /audit` — Audit log viewer

## Key Principles

- Strict tenant isolation — all queries filtered by tenantId
- Role-based access control (RBAC) enforced at route level
- Audit logging for all create/update/delete/status change actions
- Cookie-based session auth (httpOnly, secure in production)
- Parameterized queries via Drizzle ORM (SQL injection protection)
- Dynamic custom fields per tenant for unified ticket forms

## Frontend Pages

- `/` — Login
- `/dashboard` — KPIs, charts, activity feed
- `/tickets` — Advanced ticket list with filters
- `/tickets/new` — Create ticket
- `/tickets/:id` — Ticket detail with comments and audit trail
- `/portal` — Document knowledge base
- `/clients` — Tenant management (superadmin)
- `/users` — User management
- `/audit` — Audit log viewer
- `/settings` — Profile settings
