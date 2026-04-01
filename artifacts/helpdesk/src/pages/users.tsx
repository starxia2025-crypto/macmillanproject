import { useMemo, useState } from "react";
import { useCreateUser, useGetMe, useListTenants, useListUsers } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Search, Plus, Filter } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { RoleBadge } from "@/components/badges";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "@/hooks/use-toast";
import { getRoleLabel } from "@/lib/role-labels";

const createUserSchema = z.object({
  name: z.string().min(2, "Indica el nombre del usuario"),
  email: z.string().email("Introduce un correo valido"),
  role: z.string().min(1, "Selecciona un rol"),
  tenantId: z.coerce.number().optional(),
  password: z.string().min(8, "La contrasena debe tener al menos 8 caracteres"),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

export default function Users() {
  const { data: currentUser } = useGetMe();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);

  const { data: usersData, isLoading, refetch } = useListUsers({
    page,
    limit: 20,
    search: search || undefined,
    role: roleFilter !== "all" ? roleFilter : undefined,
    tenantId: currentUser?.role === "superadmin" ? undefined : currentUser?.tenantId,
  });

  const { data: tenantsData } = useListTenants(
    { page: 1, limit: 100 },
    { query: { enabled: currentUser?.role === "superadmin" } },
  );

  const availableRoles = useMemo(() => {
    if (currentUser?.role === "superadmin") {
      return [
        "superadmin",
        "admin_cliente",
        "manager",
        "tecnico",
        "usuario_cliente",
        "visor_cliente",
      ];
    }

    return ["admin_cliente", "manager", "usuario_cliente", "visor_cliente"];
  }, [currentUser?.role]);

  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema.superRefine((values, ctx) => {
      if (currentUser?.role === "superadmin" && !values.tenantId && values.role !== "superadmin" && values.role !== "tecnico") {
        ctx.addIssue({
          code: "custom",
          path: ["tenantId"],
          message: "Selecciona el cliente del nuevo usuario",
        });
      }
    })),
    defaultValues: {
      name: "",
      email: "",
      role: currentUser?.role === "superadmin" ? "admin_cliente" : "manager",
      tenantId: currentUser?.tenantId ?? undefined,
      password: "",
    },
  });

  const selectedRole = form.watch("role");

  const createUser = useCreateUser({
    mutation: {
      onSuccess: async () => {
        toast({
          title: "Usuario creado",
          description: "El nuevo acceso ya esta disponible en el sistema.",
        });
        setOpen(false);
        form.reset({
          name: "",
          email: "",
          role: currentUser?.role === "superadmin" ? "admin_cliente" : "manager",
          tenantId: currentUser?.tenantId ?? undefined,
          password: "",
        });
        await refetch();
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : "No se pudo crear el usuario.";

        toast({
          title: "No se pudo crear el usuario",
          description: message,
          variant: "destructive",
        });
      },
    },
  });

  function onSubmit(values: CreateUserValues) {
    const tenantId =
      currentUser?.role === "superadmin"
        ? values.role === "superadmin" || values.role === "tecnico"
          ? null
          : (values.tenantId ?? null)
        : (currentUser?.tenantId ?? null);

    createUser.mutate({
      data: {
        name: values.name,
        email: values.email,
        role: values.role as never,
        tenantId,
        password: values.password,
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Usuarios</h1>
          <p className="mt-1 text-slate-500">Gestiona accesos y roles del sistema.</p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) {
              form.reset({
                name: "",
                email: "",
                role: currentUser?.role === "superadmin" ? "admin_cliente" : "manager",
                tenantId: currentUser?.tenantId ?? undefined,
                password: "",
              });
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="shrink-0 gap-2">
              <Plus className="h-4 w-4" />
              Anadir usuario
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Crear nuevo usuario</DialogTitle>
              <DialogDescription>
                Da de alta accesos para coordinacion, jefatura de estudio, profesorado o equipo tecnico.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nombre completo</FormLabel>
                        <FormControl>
                          <Input placeholder="Ej. Ana Lopez" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Correo</FormLabel>
                        <FormControl>
                          <Input placeholder="ana.lopez@centro.es" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Rol</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecciona un rol" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {availableRoles.map((role) => (
                              <SelectItem key={role} value={role}>
                                {getRoleLabel(role)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {currentUser?.role === "superadmin" ? (
                    <FormField
                      control={form.control}
                      name="tenantId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Cliente</FormLabel>
                          <Select
                            disabled={selectedRole === "superadmin" || selectedRole === "tecnico"}
                            onValueChange={(value) => field.onChange(Number(value))}
                            value={field.value ? String(field.value) : undefined}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={
                                    selectedRole === "superadmin" || selectedRole === "tecnico"
                                      ? "No requiere cliente"
                                      : "Selecciona un cliente"
                                  }
                                />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {tenantsData?.data.map((tenant) => (
                                <SelectItem key={tenant.id} value={String(tenant.id)}>
                                  {tenant.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div className="rounded-lg border bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      El usuario se creara dentro de tu cliente actual.
                    </div>
                  )}
                </div>

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contrasena temporal</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Minimo 8 caracteres" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={createUser.isPending}>
                    {createUser.isPending ? "Creando..." : "Crear usuario"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="flex flex-col gap-4 p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar usuarios por nombre o correo..."
            className="w-full pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex shrink-0 gap-2">
          <Select
            value={roleFilter}
            onValueChange={(value) => {
              setRoleFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Rol" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los roles</SelectItem>
              {currentUser?.role === "superadmin" && <SelectItem value="superadmin">{getRoleLabel("superadmin")}</SelectItem>}
              <SelectItem value="admin_cliente">{getRoleLabel("admin_cliente")}</SelectItem>
              <SelectItem value="manager">{getRoleLabel("manager")}</SelectItem>
              {currentUser?.role === "superadmin" && <SelectItem value="tecnico">{getRoleLabel("tecnico")}</SelectItem>}
              <SelectItem value="usuario_cliente">{getRoleLabel("usuario_cliente")}</SelectItem>
              <SelectItem value="visor_cliente">{getRoleLabel("visor_cliente")}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" type="button">
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      <div className="overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-slate-900">
        <Table>
          <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
            <TableRow>
              <TableHead className="font-semibold">Usuario</TableHead>
              <TableHead className="font-semibold">Rol</TableHead>
              {currentUser?.role === "superadmin" && <TableHead className="font-semibold">Cliente</TableHead>}
              <TableHead className="font-semibold">Estado</TableHead>
              <TableHead className="text-right font-semibold">Ultimo acceso</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
                      <div className="space-y-1">
                        <div className="h-4 w-32 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                        <div className="h-3 w-48 animate-pulse rounded bg-slate-50 dark:bg-slate-800/50" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><div className="h-6 w-24 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" /></TableCell>
                  {currentUser?.role === "superadmin" && <TableCell><div className="h-5 w-32 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></TableCell>}
                  <TableCell><div className="h-6 w-16 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" /></TableCell>
                  <TableCell><div className="ml-auto h-5 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></TableCell>
                </TableRow>
              ))
            ) : usersData?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={currentUser?.role === "superadmin" ? 5 : 4} className="h-48 text-center text-slate-500">
                  No se encontraron usuarios.
                </TableCell>
              </TableRow>
            ) : (
              usersData?.data.map((user) => (
                <TableRow key={user.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-sm font-medium text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {user.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">{user.name}</div>
                        <div className="text-xs text-slate-500">{user.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={user.role} />
                  </TableCell>
                  {currentUser?.role === "superadmin" && (
                    <TableCell className="text-sm text-slate-600 dark:text-slate-400">
                      {user.tenantName || <span className="italic text-slate-400">Sistema</span>}
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge
                      variant={user.active ? "default" : "secondary"}
                      className={
                        user.active
                          ? "border-transparent bg-emerald-100 text-emerald-800 shadow-none hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "shadow-none"
                      }
                    >
                      {user.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-500">
                    {user.lastLoginAt ? format(new Date(user.lastLoginAt), "d MMM yyyy", { locale: es }) : "Nunca"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {usersData && usersData.totalPages > 1 && (
          <div className="flex items-center justify-between border-t bg-slate-50/50 p-4 dark:bg-slate-900/50">
            <span className="text-sm text-slate-500">
              Mostrando {(page - 1) * 20 + 1}-{Math.min(page * 20, usersData.total)} de {usersData.total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === usersData.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
