import { useState } from "react";
import { useCreateTenant, useListTenants } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Search, Plus, Building2, Users, Ticket } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

const createTenantSchema = z.object({
  name: z.string().min(2, "Indica el nombre del cliente"),
  slug: z.string().min(2, "Indica un slug").regex(/^[a-z0-9-]+$/, "Usa solo minúsculas, números y guiones"),
  contactEmail: z.string().optional(),
  primaryColor: z.string().optional(),
});

type CreateTenantValues = z.infer<typeof createTenantSchema>;

export default function ClientsAdmin() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);

  const { data: tenantsData, isLoading, refetch } = useListTenants({
    page,
    limit: 20,
    search: search || undefined,
  });

  const form = useForm<CreateTenantValues>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: {
      name: "",
      slug: "",
      contactEmail: "",
      primaryColor: "#2563eb",
    },
  });

  const createTenant = useCreateTenant({
    mutation: {
      onSuccess: async () => {
        setOpen(false);
        form.reset();
        await refetch();
      },
    },
  });

  function onSubmit(values: CreateTenantValues) {
    createTenant.mutate({
      data: {
        name: values.name,
        slug: values.slug,
        contactEmail: values.contactEmail || null,
        primaryColor: values.primaryColor || null,
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Clientes y redes escolares</h1>
          <p className="text-slate-500 mt-1">Gestiona grupos educativos, colegios asociados y su operación de soporte.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shrink-0">
              <Plus className="h-4 w-4" />
              Añadir cliente
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Alta y configuración de cliente</DialogTitle>
              <DialogDescription>Crea un nuevo grupo educativo o cliente para empezar a configurarlo.</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre</FormLabel>
                      <FormControl><Input placeholder="Ej. Educare" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Slug</FormLabel>
                      <FormControl><Input placeholder="educare" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email de contacto</FormLabel>
                      <FormControl><Input placeholder="soporte@cliente.es" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="primaryColor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Color principal</FormLabel>
                      <FormControl><Input placeholder="#2563eb" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={createTenant.isPending}>Crear cliente</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-4 flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar clientes por nombre, dominio o correo..."
            className="pl-9 w-full max-w-md"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </Card>

      <div className="bg-white dark:bg-slate-900 border rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
            <TableRow>
              <TableHead className="font-semibold">Nombre del Cliente</TableHead>
              <TableHead className="font-semibold">Estado</TableHead>
              <TableHead className="text-center font-semibold">Usuarios</TableHead>
              <TableHead className="text-center font-semibold">Tickets Abiertos</TableHead>
              <TableHead className="text-center font-semibold">Total Tickets</TableHead>
              <TableHead className="text-right font-semibold">Creado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><div className="h-5 w-48 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-6 w-16 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" /></TableCell>
                  <TableCell><div className="h-5 w-10 bg-slate-100 dark:bg-slate-800 rounded animate-pulse mx-auto" /></TableCell>
                  <TableCell><div className="h-5 w-10 bg-slate-100 dark:bg-slate-800 rounded animate-pulse mx-auto" /></TableCell>
                  <TableCell><div className="h-5 w-10 bg-slate-100 dark:bg-slate-800 rounded animate-pulse mx-auto" /></TableCell>
                  <TableCell><div className="h-5 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : tenantsData?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-48 text-center text-slate-500">
                  No se encontraron clientes.
                </TableCell>
              </TableRow>
            ) : (
              tenantsData?.data.map((tenant) => (
                <TableRow key={tenant.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">{tenant.name}</div>
                        <div className="text-xs text-slate-500">{tenant.slug}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={tenant.active ? "default" : "secondary"} className={tenant.active ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : ""}>
                      {tenant.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <Users className="h-4 w-4 text-slate-400" />
                      {tenant.totalUsers}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1.5 font-medium text-amber-600 dark:text-amber-500">
                      <Ticket className="h-4 w-4" />
                      {tenant.openTickets}
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-slate-500">{tenant.totalTickets}</TableCell>
                  <TableCell className="text-right text-sm text-slate-500">
                    {format(new Date(tenant.createdAt), "d MMM yyyy", { locale: es })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {tenantsData && tenantsData.totalPages > 1 && (
          <div className="p-4 border-t flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
            <span className="text-sm text-slate-500">
              Mostrando {(page - 1) * 20 + 1}–{Math.min(page * 20, tenantsData.total)} de {tenantsData.total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page === tenantsData.totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
