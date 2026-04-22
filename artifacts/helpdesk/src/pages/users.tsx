import { useMemo, useState } from "react";
import { useCreateUser, useGetMe, useGetTenant, useListTenants, useListUsers, useUpdateUser } from "@workspace/api-client-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Search, Plus, Filter, Pencil, Power } from "lucide-react";
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
  schoolId: z.coerce.number().optional(),
  scopeType: z.enum(["global", "tenant", "school"]),
  password: z.string().min(12, "La contrasena debe tener al menos 12 caracteres"),
});

const editUserSchema = z.object({
  name: z.string().min(2, "Indica el nombre del usuario"),
  role: z.string().min(1, "Selecciona un rol"),
  tenantId: z.coerce.number().optional(),
  schoolId: z.coerce.number().optional(),
  scopeType: z.enum(["global", "tenant", "school"]),
  active: z.boolean(),
});

type CreateUserValues = z.infer<typeof createUserSchema>;
type EditUserValues = z.infer<typeof editUserSchema>;
type UserRow = {
  id: number;
  email: string;
  name: string;
  role: string;
  tenantId?: number | null;
  tenantName?: string | null;
  schoolId?: number | null;
  schoolName?: string | null;
  scopeType?: "global" | "tenant" | "school";
  active: boolean;
  lastLoginAt?: string | null;
};

export default function Users() {
  const { data: currentUser } = useGetMe();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const canCreateUsersWithPassword = currentUser?.role === "superadmin" || currentUser?.role === "tecnico";

  const { data: usersData, isLoading, refetch } = useListUsers({
    page,
    limit: 100,
    search: search || undefined,
    role: roleFilter !== "all" ? roleFilter : undefined,
    tenantId: currentUser?.role === "superadmin" || currentUser?.role === "tecnico" ? undefined : currentUser?.tenantId,
  });

  const { data: tenantsData } = useListTenants(
    { page: 1, limit: 100 },
    { query: { enabled: currentUser?.role === "superadmin" || currentUser?.role === "tecnico" } },
  );
  const { data: currentTenantData } = useGetTenant(currentUser?.tenantId ?? 0, {
    query: { enabled: !!currentUser?.tenantId && currentUser?.role === "admin_cliente" },
  });

  const availableTenants = useMemo(() => {
    if (currentUser?.role === "superadmin" || currentUser?.role === "tecnico") {
      return tenantsData?.data ?? [];
    }

    return currentTenantData ? [currentTenantData] : [];
  }, [currentTenantData, currentUser?.role, tenantsData?.data]);

  const sortedUsers = useMemo(() => {
    const rows = [...(usersData?.data ?? [])] as UserRow[];
    return rows.sort((a, b) => {
      const schoolA = (a.schoolName || a.tenantName || currentUser?.schoolName || currentUser?.tenantName || "Sin colegio").toLocaleLowerCase("es");
      const schoolB = (b.schoolName || b.tenantName || currentUser?.schoolName || currentUser?.tenantName || "Sin colegio").toLocaleLowerCase("es");
      if (schoolA !== schoolB) return schoolA.localeCompare(schoolB, "es");
      return a.name.localeCompare(b.name, "es");
    });
  }, [usersData?.data, currentUser?.schoolName, currentUser?.tenantName]);

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

    if (currentUser?.role === "tecnico") {
      return [
        "admin_cliente",
        "manager",
        "tecnico",
        "usuario_cliente",
        "visor_cliente",
      ];
    }

    return ["admin_cliente", "manager", "usuario_cliente", "visor_cliente"];
  }, [currentUser?.role]);

  function getDefaultScopeForRole(role: string) {
    switch (role) {
      case "superadmin":
      case "tecnico":
        return "global" as const;
      case "admin_cliente":
      case "visor_cliente":
        return "tenant" as const;
      default:
        return "school" as const;
    }
  }

  const createForm = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema.superRefine((values, ctx) => {
      if (values.scopeType === "tenant" && !values.tenantId) {
        ctx.addIssue({
          code: "custom",
          path: ["tenantId"],
          message: "Selecciona la red educativa del nuevo usuario",
        });
      }

      if (values.scopeType === "school" && !values.schoolId) {
        ctx.addIssue({
          code: "custom",
          path: ["schoolId"],
          message: "Selecciona el colegio del nuevo usuario",
        });
      }
    })),
    defaultValues: {
      name: "",
      email: "",
      role: currentUser?.role === "superadmin" ? "admin_cliente" : "manager",
      tenantId: currentUser?.tenantId ?? undefined,
      schoolId: currentUser?.schoolId ?? undefined,
      scopeType: getDefaultScopeForRole(currentUser?.role === "superadmin" ? "admin_cliente" : "manager"),
      password: "",
    },
  });

  const editForm = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema.superRefine((values, ctx) => {
      if (values.scopeType === "tenant" && !values.tenantId) {
        ctx.addIssue({
          code: "custom",
          path: ["tenantId"],
          message: "Selecciona la red educativa del usuario",
        });
      }

      if (values.scopeType === "school" && !values.schoolId) {
        ctx.addIssue({
          code: "custom",
          path: ["schoolId"],
          message: "Selecciona el colegio del usuario",
        });
      }
    })),
    defaultValues: {
      name: "",
      role: currentUser?.role === "superadmin" ? "admin_cliente" : "manager",
      tenantId: currentUser?.tenantId ?? undefined,
      schoolId: currentUser?.schoolId ?? undefined,
      scopeType: getDefaultScopeForRole(currentUser?.role === "superadmin" ? "admin_cliente" : "manager"),
      active: true,
    },
  });

  const selectedCreateScopeType = createForm.watch("scopeType");
  const selectedCreateTenantId = createForm.watch("tenantId");
  const selectedEditScopeType = editForm.watch("scopeType");
  const selectedEditTenantId = editForm.watch("tenantId");

  const createTenantOptions = useMemo(() => availableTenants, [availableTenants]);
  const editTenantOptions = useMemo(() => availableTenants, [availableTenants]);

  const createSchoolOptions = useMemo(() => {
    const tenant = createTenantOptions.find((item) => item.id === selectedCreateTenantId);
    return (tenant?.schools ?? []).filter((school) => school.active);
  }, [createTenantOptions, selectedCreateTenantId]);

  const editSchoolOptions = useMemo(() => {
    const tenant = editTenantOptions.find((item) => item.id === selectedEditTenantId);
    return (tenant?.schools ?? []).filter((school) => school.active);
  }, [editTenantOptions, selectedEditTenantId]);

  function resetCreateForm() {
    createForm.reset({
      name: "",
      email: "",
      role: currentUser?.role === "superadmin" ? "admin_cliente" : "manager",
      tenantId: currentUser?.tenantId ?? undefined,
      schoolId: currentUser?.schoolId ?? undefined,
      scopeType: getDefaultScopeForRole(currentUser?.role === "superadmin" ? "admin_cliente" : "manager"),
      password: "",
    });
  }

  function openEditDialog(user: UserRow) {
    setEditingUser(user);
    editForm.reset({
      name: user.name,
      role: user.role,
      tenantId: user.tenantId ?? undefined,
      schoolId: user.schoolId ?? undefined,
      scopeType: user.scopeType ?? getDefaultScopeForRole(user.role),
      active: user.active,
    });
    setEditOpen(true);
  }

  const createUser = useCreateUser({
    mutation: {
      onSuccess: async () => {
        toast({
          title: "Usuario creado",
          description: "El nuevo acceso ya esta disponible en el sistema.",
        });
        setCreateOpen(false);
        resetCreateForm();
        await refetch();
      },
      onError: (error) => {
        const rawMessage = error instanceof Error ? error.message : "No se pudo crear el usuario.";
        const message = rawMessage.includes("Ya existe un usuario con ese correo")
          ? "Ya existe un usuario con ese correo. Usa otro email o reactiva el acceso existente."
          : rawMessage;

        toast({
          title: "No se pudo crear el usuario",
          description: message,
          variant: "destructive",
        });
      },
    },
  });

  const updateUser = useUpdateUser({
    mutation: {
      onSuccess: async (_, variables) => {
        const title = variables.data.active === false ? "Usuario desactivado" : variables.data.active === true && Object.keys(variables.data).length === 1 ? "Usuario reactivado" : "Usuario actualizado";
        toast({
          title,
          description: variables.data.active === false
            ? "El usuario ya no podra acceder al sistema."
            : variables.data.active === true && Object.keys(variables.data).length === 1
              ? "El usuario vuelve a tener acceso al sistema."
              : "Los cambios del usuario ya estan guardados.",
        });
        setEditOpen(false);
        setEditingUser(null);
        await refetch();
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : "No se pudo actualizar el usuario.";
        toast({
          title: "No se pudo actualizar el usuario",
          description: message,
          variant: "destructive",
        });
      },
    },
  });

  function onCreateSubmit(values: CreateUserValues) {
    const normalizedEmail = values.email.trim().toLowerCase();
    const emailExists = sortedUsers.some((user) => user.email.trim().toLowerCase() === normalizedEmail);

    if (emailExists) {
      toast({
        title: "Correo ya registrado",
        description: "Ya existe un usuario con ese correo. Usa otro email o reactiva el acceso existente.",
        variant: "destructive",
      });
      return;
    }

    const tenantId =
      values.scopeType === "global"
        ? null
        : currentUser?.role === "superadmin" || currentUser?.role === "tecnico"
          ? (values.tenantId ?? null)
          : (currentUser?.tenantId ?? null);

    const schoolId = values.scopeType === "school" ? (values.schoolId ?? null) : null;

    createUser.mutate({
      data: {
        name: values.name,
        email: normalizedEmail,
        role: values.role as never,
        tenantId,
        schoolId,
        scopeType: values.scopeType,
        password: values.password,
      },
    });
  }

  function onEditSubmit(values: EditUserValues) {
    if (!editingUser) return;

    const tenantId =
      values.scopeType === "global"
        ? null
        : currentUser?.role === "superadmin" || currentUser?.role === "tecnico"
          ? (values.tenantId ?? null)
          : (currentUser?.tenantId ?? null);

    const schoolId = values.scopeType === "school" ? (values.schoolId ?? null) : null;

    updateUser.mutate({
      userId: editingUser.id,
      data: {
        name: values.name,
        role: values.role as never,
        tenantId,
        schoolId,
        scopeType: values.scopeType,
        active: values.active,
      },
    });
  }

  function toggleUserActive(user: UserRow) {
    updateUser.mutate({
      userId: user.id,
      data: { active: !user.active },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Usuarios</h1>
          <p className="mt-1 text-slate-500">Gestiona accesos, roles y estado de los miembros del sistema.</p>
        </div>
        {canCreateUsersWithPassword && (
          <Dialog
            open={createOpen}
            onOpenChange={(nextOpen) => {
              setCreateOpen(nextOpen);
              if (!nextOpen) resetCreateForm();
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
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField control={createForm.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre completo</FormLabel>
                      <FormControl><Input placeholder="Ej. Ana Lopez" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={createForm.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Correo</FormLabel>
                      <FormControl><Input placeholder="ana.lopez@centro.es" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField control={createForm.control} name="role" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rol</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value);
                          const nextScope = getDefaultScopeForRole(value);
                          createForm.setValue("scopeType", nextScope);
                          if (nextScope === "global") {
                            createForm.setValue("tenantId", undefined);
                            createForm.setValue("schoolId", undefined);
                          } else if (nextScope === "tenant") {
                            createForm.setValue("schoolId", undefined);
                          }
                        }}
                        value={field.value}
                      >
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecciona un rol" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {availableRoles.map((role) => (
                            <SelectItem key={role} value={role}>{getRoleLabel(role)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={createForm.control} name="scopeType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ambito de acceso</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value as "global" | "tenant" | "school");
                          if (value === "global") {
                            createForm.setValue("tenantId", undefined);
                            createForm.setValue("schoolId", undefined);
                          }
                          if (value === "tenant") {
                            createForm.setValue("schoolId", undefined);
                          }
                        }}
                        value={field.value}
                      >
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecciona el alcance" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {(currentUser?.role === "superadmin" || currentUser?.role === "tecnico") && (
                            <SelectItem value="global">Todo el sistema</SelectItem>
                          )}
                          <SelectItem value="tenant">Toda la red educativa</SelectItem>
                          <SelectItem value="school">Solo un colegio</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {(currentUser?.role === "superadmin" || currentUser?.role === "tecnico") ? (
                    <FormField control={createForm.control} name="tenantId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Red educativa</FormLabel>
                        <Select
                          disabled={selectedCreateScopeType === "global"}
                          onValueChange={(value) => {
                            field.onChange(Number(value));
                            createForm.setValue("schoolId", undefined);
                          }}
                          value={field.value ? String(field.value) : undefined}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={selectedCreateScopeType === "global" ? "No requiere red" : "Selecciona una red"} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {createTenantOptions.map((tenant) => (
                              <SelectItem key={tenant.id} value={String(tenant.id)}>{tenant.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  ) : (
                    <div className="rounded-lg border bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      El usuario se creara dentro de tu red educativa actual.
                    </div>
                  )}

                  <FormField control={createForm.control} name="schoolId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Colegio</FormLabel>
                      <Select
                        disabled={selectedCreateScopeType !== "school"}
                        onValueChange={(value) => field.onChange(Number(value))}
                        value={field.value ? String(field.value) : undefined}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={selectedCreateScopeType !== "school" ? "No requiere colegio concreto" : "Selecciona un colegio"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {createSchoolOptions.map((school) => (
                            <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={createForm.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contrasena temporal</FormLabel>
                    <FormControl><Input type="password" placeholder="Minimo 12 caracteres" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={createUser.isPending}>{createUser.isPending ? "Creando..." : "Crear usuario"}</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
          </Dialog>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={(nextOpen) => { setEditOpen(nextOpen); if (!nextOpen) setEditingUser(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar usuario</DialogTitle>
            <DialogDescription>Ajusta el rol, el colegio asociado y el estado de acceso del usuario.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField control={editForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre completo</FormLabel>
                  <FormControl><Input placeholder="Ej. Ana Lopez" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {editingUser && (
                <div className="rounded-lg border bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Correo asociado: <span className="font-medium text-slate-900">{editingUser.email}</span>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <FormField control={editForm.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rol</FormLabel>
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value);
                        const nextScope = getDefaultScopeForRole(value);
                        editForm.setValue("scopeType", nextScope);
                        if (nextScope === "global") {
                          editForm.setValue("tenantId", undefined);
                          editForm.setValue("schoolId", undefined);
                        } else if (nextScope === "tenant") {
                          editForm.setValue("schoolId", undefined);
                        }
                      }}
                      value={field.value}
                    >
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecciona un rol" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {availableRoles.map((role) => (
                          <SelectItem key={role} value={role}>{getRoleLabel(role)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={editForm.control} name="scopeType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ambito de acceso</FormLabel>
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value as "global" | "tenant" | "school");
                        if (value === "global") {
                          editForm.setValue("tenantId", undefined);
                          editForm.setValue("schoolId", undefined);
                        }
                        if (value === "tenant") {
                          editForm.setValue("schoolId", undefined);
                        }
                      }}
                      value={field.value}
                    >
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecciona el alcance" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {(currentUser?.role === "superadmin" || currentUser?.role === "tecnico") && (
                          <SelectItem value="global">Todo el sistema</SelectItem>
                        )}
                        <SelectItem value="tenant">Toda la red educativa</SelectItem>
                        <SelectItem value="school">Solo un colegio</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {(currentUser?.role === "superadmin" || currentUser?.role === "tecnico") ? (
                  <FormField control={editForm.control} name="tenantId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Red educativa</FormLabel>
                      <Select
                        disabled={selectedEditScopeType === "global"}
                        onValueChange={(value) => {
                          field.onChange(Number(value));
                          editForm.setValue("schoolId", undefined);
                        }}
                        value={field.value ? String(field.value) : undefined}
                      >
                        <FormControl><SelectTrigger><SelectValue placeholder={selectedEditScopeType === "global" ? "No requiere red" : "Selecciona una red"} /></SelectTrigger></FormControl>
                        <SelectContent>
                          {editTenantOptions.map((tenant) => (
                            <SelectItem key={tenant.id} value={String(tenant.id)}>{tenant.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                ) : (
                  <div className="rounded-lg border bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Este usuario pertenece a tu red educativa actual.
                  </div>
                )}

                <FormField control={editForm.control} name="schoolId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Colegio</FormLabel>
                    <Select
                      disabled={selectedEditScopeType !== "school"}
                      onValueChange={(value) => field.onChange(Number(value))}
                      value={field.value ? String(field.value) : undefined}
                    >
                      <FormControl><SelectTrigger><SelectValue placeholder={selectedEditScopeType !== "school" ? "No requiere colegio concreto" : "Selecciona un colegio"} /></SelectTrigger></FormControl>
                      <SelectContent>
                        {editSchoolOptions.map((school) => (
                          <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={editForm.control} name="active" render={({ field }) => (
                <FormItem>
                  <FormLabel>Estado</FormLabel>
                  <Select onValueChange={(value) => field.onChange(value === "true")} value={String(field.value)}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Selecciona un estado" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="true">Activo</SelectItem>
                      <SelectItem value="false">Inactivo</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={updateUser.isPending}>{updateUser.isPending ? "Guardando..." : "Guardar cambios"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Card className="flex flex-col gap-4 p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Buscar usuarios por nombre o correo..." className="w-full pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div className="flex shrink-0 gap-2">
          <Select value={roleFilter} onValueChange={(value) => { setRoleFilter(value); setPage(1); }}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Rol" /></SelectTrigger>
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
          <Button variant="outline" size="icon" type="button"><Filter className="h-4 w-4" /></Button>
        </div>
      </Card>

      <div className="overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-slate-900">
        <Table>
          <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
            <TableRow>
              <TableHead className="font-semibold">Colegio</TableHead>
              <TableHead className="font-semibold">Usuario</TableHead>
              <TableHead className="font-semibold">Rol</TableHead>
              <TableHead className="font-semibold">Estado</TableHead>
              <TableHead className="text-right font-semibold">Ultimo acceso</TableHead>
              <TableHead className="text-right font-semibold">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><div className="h-5 w-32 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="h-4 w-32 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                      <div className="h-3 w-48 animate-pulse rounded bg-slate-50 dark:bg-slate-800/50" />
                    </div>
                  </TableCell>
                  <TableCell><div className="h-6 w-24 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" /></TableCell>
                  <TableCell><div className="h-6 w-16 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" /></TableCell>
                  <TableCell><div className="ml-auto h-5 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></TableCell>
                  <TableCell><div className="ml-auto h-8 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></TableCell>
                </TableRow>
              ))
            ) : sortedUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-48 text-center text-slate-500">No se encontraron usuarios.</TableCell>
              </TableRow>
            ) : (
              sortedUsers.map((user) => (
                <TableRow key={user.id} className="group">
                  <TableCell className="text-sm text-slate-600 dark:text-slate-400">
                    <div className="space-y-1">
                      <div>{user.schoolName || user.tenantName || currentUser?.schoolName || currentUser?.tenantName || <span className="italic text-slate-400">Sistema</span>}</div>
                      {user.schoolName && user.tenantName && user.schoolName !== user.tenantName && (
                        <div className="text-xs text-slate-400">Red: {user.tenantName}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-sm font-medium text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{user.name.charAt(0)}</div>
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">{user.name}</div>
                        <div className="text-xs text-slate-500">{user.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><RoleBadge role={user.role} /></TableCell>
                  <TableCell>
                    <Badge variant={user.active ? "default" : "secondary"} className={user.active ? "border-transparent bg-emerald-100 text-emerald-800 shadow-none hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400" : "shadow-none"}>
                      {user.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-500">{user.lastLoginAt ? format(new Date(user.lastLoginAt), "d MMM yyyy", { locale: es }) : "Nunca"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => openEditDialog(user as UserRow)}>
                        <Pencil className="h-4 w-4" />
                        Editar
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="outline" size="sm" className="gap-2">
                            <Power className="h-4 w-4" />
                            {user.active ? "Eliminar" : "Reactivar"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{user.active ? "Desactivar acceso" : "Reactivar acceso"}</AlertDialogTitle>
                            <AlertDialogDescription>{user.active ? "El usuario dejara de poder entrar al sistema, pero se conservara su historial." : "El usuario recuperara acceso al sistema con su mismo historial."}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => toggleUserActive(user as UserRow)}>{user.active ? "Desactivar" : "Reactivar"}</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
