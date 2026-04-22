import { useMemo, useState } from "react";
import { useCreateTenant, useGetMe, useListTenants, useUpdateTenant } from "@workspace/api-client-react";
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
import { Search, Plus, Building2, Users, Ticket, Link as LinkIcon, Trash2, Upload, ExternalLink, Pencil, Power } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const sidebarPalette = [
  { label: "Azul Macmillan", value: "#0f172a" },
  { label: "Azul profundo", value: "#172554" },
  { label: "Verde aula", value: "#14532d" },
  { label: "Granate", value: "#7f1d1d" },
  { label: "Gris oscuro", value: "#1f2937" },
  { label: "Blanco", value: "#ffffff" },
];

const textPalette = [
  { label: "Blanco", value: "#ffffff" },
  { label: "Crema", value: "#f8fafc" },
  { label: "Azul noche", value: "#0f172a" },
  { label: "Negro", value: "#111827" },
];

const buttonPalette = [
  { label: "Azul login", value: "#2563eb" },
  { label: "Azul Macmillan", value: "#4f46e5" },
  { label: "Verde aula", value: "#16a34a" },
  { label: "Granate", value: "#7f1d1d" },
  { label: "Naranja", value: "#f97316" },
  { label: "Negro", value: "#111827" },
];

const tenantFormSchema = z.object({
  name: z.string().trim().min(2, "Indica el nombre del colegio"),
  contactEmail: z.union([z.literal(""), z.string().trim().email("Introduce un email valido")]).optional(),
  primaryColor: z.string().min(1, "Selecciona un color para el boton de inicio de sesion"),
  sidebarBackgroundColor: z.string().min(1, "Selecciona un color para el menu"),
  sidebarTextColor: z.string().min(1, "Selecciona un color de texto"),
  logoUrl: z.string().optional(),
  hasMochilasAccess: z.boolean().default(false),
  hasOrderLookup: z.boolean().default(false),
  hasReturnsAccess: z.boolean().default(false),
});

type TenantFormValues = z.infer<typeof tenantFormSchema>;
type QuickLinkDraft = {
  id: string;
  label: string;
  url: string;
  icon: string;
  previewUrl?: string;
  iconFile?: File;
};
type SchoolDraft = {
  id?: number;
  localId: string;
  name: string;
  code: string;
  isHeadquarters: boolean;
  active: boolean;
};
type TenantRow = {
  id: number;
  name: string;
  slug: string;
  active: boolean;
  totalUsers: number;
  openTickets: number;
  totalTickets: number;
  createdAt: string;
  contactEmail?: string | null;
  primaryColor?: string | null;
  sidebarBackgroundColor?: string | null;
  sidebarTextColor?: string | null;
  logoUrl?: string | null;
  hasMochilasAccess?: boolean | null;
  hasOrderLookup?: boolean | null;
  hasReturnsAccess?: boolean | null;
  quickLinks?: Array<{ label: string; url: string; icon: string }> | null;
  schools?: Array<{ id: number; name: string; code?: string | null; isHeadquarters?: boolean; active: boolean }> | null;
};

function isQuickLinkImage(icon: string) {
  const normalizedIcon = icon.trim();
  return normalizedIcon.startsWith("data:image/") || normalizedIcon.startsWith("http://") || normalizedIcon.startsWith("https://");
}

function normalizeQuickLinkIcon(icon: string) {
  const normalizedIcon = icon.trim();
  return normalizedIcon || "🔗";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.trim()) {
        resolve(reader.result.trim());
        return;
      }
      reject(new Error("No se pudo convertir la imagen seleccionada."));
    };
    reader.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
    reader.readAsDataURL(file);
  });
}

function removeSolidImageBackground(dataUrl: string) {
  return new Promise<string>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const maxSize = 512;
      const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        resolve(dataUrl);
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      const cornerIndexes = [
        0,
        (canvas.width - 1) * 4,
        ((canvas.height - 1) * canvas.width) * 4,
        ((canvas.height - 1) * canvas.width + canvas.width - 1) * 4,
      ];
      const background = cornerIndexes.reduce(
        (acc, index) => {
          acc.r += pixels[index];
          acc.g += pixels[index + 1];
          acc.b += pixels[index + 2];
          return acc;
        },
        { r: 0, g: 0, b: 0 },
      );
      background.r /= cornerIndexes.length;
      background.g /= cornerIndexes.length;
      background.b /= cornerIndexes.length;

      const tolerance = 46;
      for (let index = 0; index < pixels.length; index += 4) {
        const distance =
          Math.abs(pixels[index] - background.r) +
          Math.abs(pixels[index + 1] - background.g) +
          Math.abs(pixels[index + 2] - background.b);
        if (distance < tolerance) {
          pixels[index + 3] = 0;
        }
      }

      context.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

function slugifyTenantName(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || `cliente-${Date.now()}`;
}

function createEmptyQuickLink(): QuickLinkDraft {
  return {
    id: crypto.randomUUID(),
    label: "",
    url: "",
    icon: "",
    previewUrl: undefined,
    iconFile: undefined,
  };
}

function createEmptySchool(): SchoolDraft {
  return {
    localId: crypto.randomUUID(),
    name: "",
    code: "",
    isHeadquarters: false,
    active: true,
  };
}

function inferQuickLinkLabel(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const firstSegment = hostname.split(".")[0] || hostname;
    return firstSegment
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

function mapQuickLinksToDrafts(quickLinks?: Array<{ label: string; url: string; icon: string }> | null): QuickLinkDraft[] {
  if (!Array.isArray(quickLinks)) return [];

  return quickLinks.map((link) => ({
    id: crypto.randomUUID(),
    label: link.label ?? "",
    url: link.url ?? "",
    icon: link.icon ?? "",
    previewUrl: undefined,
    iconFile: undefined,
  }));
}

function mapSchoolsToDrafts(schools?: Array<{ id: number; name: string; code?: string | null; isHeadquarters?: boolean; active: boolean }> | null): SchoolDraft[] {
  if (!Array.isArray(schools)) return [];

  return schools.map((school) => ({
    id: school.id,
    localId: crypto.randomUUID(),
    name: school.name ?? "",
    code: school.code ?? "",
    isHeadquarters: Boolean(school.isHeadquarters),
    active: school.active,
  }));
}

export default function ClientsAdmin() {
  const { data: currentUser } = useGetMe();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantRow | null>(null);
  const [quickLinks, setQuickLinks] = useState<QuickLinkDraft[]>([]);
  const [schools, setSchools] = useState<SchoolDraft[]>([]);

  const { data: tenantsData, isLoading, refetch } = useListTenants({
    page,
    limit: 20,
    search: search || undefined,
  });

  const canManageTenants = useMemo(
    () => ["superadmin", "tecnico", "manager"].includes(currentUser?.role || ""),
    [currentUser?.role],
  );

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: {
      name: "",
      contactEmail: "",
      primaryColor: "#2563eb",
      sidebarBackgroundColor: "#0f172a",
      sidebarTextColor: "#ffffff",
      logoUrl: "",
      hasMochilasAccess: false,
      hasOrderLookup: false,
      hasReturnsAccess: false,
    },
  });

  const sidebarBackgroundColor = form.watch("sidebarBackgroundColor");
  const sidebarTextColor = form.watch("sidebarTextColor");
  const primaryColor = form.watch("primaryColor");

  function resetTenantForm() {
    setEditingTenant(null);
    setQuickLinks([]);
    setSchools([]);
    form.reset({
      name: "",
      contactEmail: "",
      primaryColor: "#2563eb",
      sidebarBackgroundColor: "#0f172a",
      sidebarTextColor: "#ffffff",
      logoUrl: "",
      hasMochilasAccess: false,
      hasOrderLookup: false,
      hasReturnsAccess: false,
    });
  }

  function openCreateDialog() {
    resetTenantForm();
    setOpen(true);
  }

  function openEditDialog(tenant: TenantRow) {
    setEditingTenant(tenant);
    setQuickLinks(mapQuickLinksToDrafts(tenant.quickLinks));
    setSchools(mapSchoolsToDrafts(tenant.schools));
    form.reset({
      name: tenant.name,
      contactEmail: tenant.contactEmail ?? "",
      primaryColor: tenant.primaryColor || "#2563eb",
      sidebarBackgroundColor: tenant.sidebarBackgroundColor || "#0f172a",
      sidebarTextColor: tenant.sidebarTextColor || "#ffffff",
      logoUrl: tenant.logoUrl || "",
      hasMochilasAccess: Boolean(tenant.hasMochilasAccess),
      hasOrderLookup: Boolean(tenant.hasOrderLookup),
      hasReturnsAccess: Boolean(tenant.hasReturnsAccess),
    });
    setOpen(true);
  }

  const createTenant = useCreateTenant({
    mutation: {
      onSuccess: async () => {
        toast({
          title: "Colegio creado",
          description: "El nuevo colegio ya esta disponible para configurarlo.",
        });
        setOpen(false);
        resetTenantForm();
        await refetch();
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : "No se pudo crear el colegio.";
        toast({
          title: "No se pudo crear el colegio",
          description: message,
          variant: "destructive",
        });
      },
    },
  });

  const updateTenant = useUpdateTenant({
    mutation: {
      onSuccess: async (_, variables) => {
        const action = variables.data.active === false ? "Colegio desactivado" : variables.data.active === true ? "Colegio reactivado" : "Colegio actualizado";
        toast({
          title: action,
          description: variables.data.active === false
            ? "El colegio ha quedado sin acceso operativo."
            : variables.data.active === true
              ? "El colegio vuelve a estar disponible para su equipo."
              : "Los cambios del colegio ya estan guardados.",
        });
        setOpen(false);
        resetTenantForm();
        await refetch();
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : "No se pudo actualizar el colegio.";
        toast({
          title: "No se pudo actualizar el colegio",
          description: message,
          variant: "destructive",
        });
      },
    },
  });

  async function normalizeQuickLinks() {
    const normalizedLinks = [];

    for (const [index, link] of quickLinks.entries()) {
      if (!(link.label.trim() || link.url.trim() || link.icon.trim() || link.iconFile)) {
        continue;
      }

        const url = link.url.trim();
        const label = link.label.trim() || inferQuickLinkLabel(url);
        const icon = link.iconFile ? await readFileAsDataUrl(link.iconFile) : normalizeQuickLinkIcon(link.icon);

        if (!url) {
          throw new Error(`Completa la URL en el acceso directo ${index + 1}.`);
        }

        try {
          new URL(url);
        } catch {
          throw new Error(`La URL del acceso directo ${index + 1} no es valida.`);
        }

        if (!label) {
          throw new Error(`Completa el nombre del acceso directo ${index + 1}.`);
        }

      normalizedLinks.push({ label, url, icon });
    }

    return normalizedLinks;
  }

  function normalizeSchools() {
    const normalized = schools
      .filter((school) => school.name.trim())
      .map((school) => ({
        ...(school.id ? { id: school.id } : {}),
        name: school.name.trim(),
        code: school.code.trim() || null,
        isHeadquarters: school.isHeadquarters,
        active: school.active,
      }));

    const headquarters = normalized.filter((school) => school.isHeadquarters);
    if (headquarters.length > 1) {
      throw new Error("Solo puede haber un colegio matriz marcado como principal.");
    }

    return normalized;
  }

  async function onSubmit(values: TenantFormValues) {
    if (!canManageTenants) {
      toast({
        title: "Accion no permitida",
        description: "Tu perfil no tiene permisos para gestionar colegios.",
        variant: "destructive",
      });
      return;
    }

    try {
      const normalizedQuickLinks = await normalizeQuickLinks();
      const normalizedSchools = normalizeSchools();
      const payload = {
        name: values.name.trim(),
        ...(values.contactEmail ? { contactEmail: values.contactEmail.trim().toLowerCase() } : { contactEmail: null }),
        primaryColor: values.primaryColor,
        sidebarBackgroundColor: values.sidebarBackgroundColor,
        sidebarTextColor: values.sidebarTextColor,
        logoUrl: values.logoUrl?.trim() || null,
        hasMochilasAccess: values.hasMochilasAccess,
        hasOrderLookup: values.hasOrderLookup,
        hasReturnsAccess: values.hasReturnsAccess,
        quickLinks: normalizedQuickLinks,
        schools: normalizedSchools,
      } as any;

      if (editingTenant) {
        updateTenant.mutate({
          tenantId: editingTenant.id,
          data: payload,
        });
        return;
      }

      createTenant.mutate({
        data: {
          ...payload,
          slug: slugifyTenantName(values.name),
        },
      });
    } catch (error) {
      toast({
        title: "Accesos directos no validos",
        description: error instanceof Error ? error.message : "Revisa la configuracion de accesos directos.",
        variant: "destructive",
      });
    }
  }

  function addQuickLink() {
    setQuickLinks((current) => [...current, createEmptyQuickLink()]);
  }

  function addSchool() {
    setSchools((current) => [...current, createEmptySchool()]);
  }

  function updateQuickLink(id: string, changes: Partial<QuickLinkDraft>) {
    setQuickLinks((current) => current.map((link) => (link.id === id ? { ...link, ...changes } : link)));
  }

  function removeQuickLink(id: string) {
    setQuickLinks((current) => current.filter((link) => link.id !== id));
  }

  function updateSchool(localId: string, changes: Partial<SchoolDraft>) {
    setSchools((current) => current.map((school) => {
      if (school.localId !== localId) return school;

      const next = { ...school, ...changes };
      if (changes.isHeadquarters) {
        return { ...next, isHeadquarters: true };
      }
      return next;
    }).map((school) => {
      if (changes.isHeadquarters && school.localId !== localId) {
        return { ...school, isHeadquarters: false };
      }
      return school;
    }));
  }

  function removeSchool(localId: string) {
    setSchools((current) => current.filter((school) => school.localId !== localId));
  }

  function onShortcutIconSelected(id: string, file?: File | null) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        title: "Icono no valido",
        description: "Selecciona una imagen PNG, JPG, SVG o similar.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast({
        title: "Icono demasiado grande",
        description: "Usa una imagen o GIF de hasta 8 MB para el acceso directo.",
        variant: "destructive",
      });
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    updateQuickLink(id, {
      icon: "",
      iconFile: file,
      previewUrl,
    });
  }

  async function onTenantLogoSelected(file?: File | null) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        title: "Logotipo no valido",
        description: "Selecciona una imagen PNG, JPG, SVG o similar.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast({
        title: "Logotipo demasiado grande",
        description: "Usa una imagen de hasta 8 MB.",
        variant: "destructive",
      });
      return;
    }

    try {
      const rawLogoUrl = await readFileAsDataUrl(file);
      const logoUrl = file.type === "image/svg+xml" ? rawLogoUrl : await removeSolidImageBackground(rawLogoUrl);
      form.setValue("logoUrl", logoUrl, { shouldDirty: true, shouldValidate: true });
    } catch (error) {
      toast({
        title: "No se pudo cargar el logotipo",
        description: error instanceof Error ? error.message : "Intentalo de nuevo.",
        variant: "destructive",
      });
    }
  }

  function setTenantActive(tenant: TenantRow, active: boolean) {
    updateTenant.mutate({
      tenantId: tenant.id,
      data: { active },
    });
  }

  const isSaving = createTenant.isPending || updateTenant.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Colegios y redes escolares</h1>
          <p className="mt-1 text-slate-500">Gestiona colegios, grupos educativos asociados y su operacion de soporte.</p>
        </div>
        {canManageTenants && (
          <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
              setOpen(nextOpen);
              if (!nextOpen) resetTenantForm();
            }}
          >
            <DialogTrigger asChild>
              <Button className="shrink-0 gap-2" onClick={openCreateDialog}>
                <Plus className="h-4 w-4" />
                Anadir colegio
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
              <DialogHeader className="border-b px-6 pb-4 pt-6">
                <DialogTitle>{editingTenant ? "Editar colegio" : "Alta y configuracion de colegio"}</DialogTitle>
                <DialogDescription>
                  {editingTenant
                    ? "Actualiza branding, correos y accesos directos del colegio."
                    : "Crea un nuevo grupo educativo, elige los colores del menu lateral y define accesos directos para su equipo."}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex max-h-[calc(90vh-88px)] flex-col">
                  <div className="space-y-5 overflow-y-auto px-6 py-5">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nombre</FormLabel>
                          <FormControl><Input placeholder="Ej. Grupo Escolar Norte" {...field} /></FormControl>
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
                      name="logoUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Logotipo del colegio</FormLabel>
                          <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
                            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white">
                              {field.value ? (
                                <img src={field.value} alt="Logotipo del colegio" className="h-full w-full object-contain p-2" />
                              ) : (
                                <Building2 className="h-7 w-7 text-slate-400" />
                              )}
                            </div>
                            <div className="flex-1 space-y-2">
                              <FormControl>
                                <Input placeholder="URL del logotipo o sube una imagen" {...field} />
                              </FormControl>
                              <div className="flex flex-wrap gap-2">
                                <label htmlFor="tenant-logo-upload" className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50">
                                  <Upload className="h-4 w-4" />
                                  Subir logotipo
                                </label>
                                {field.value && (
                                  <Button type="button" variant="ghost" size="sm" onClick={() => field.onChange("")}>
                                    Quitar logotipo
                                  </Button>
                                )}
                              </div>
                              <input
                                id="tenant-logo-upload"
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(event) => {
                                  void onTenantLogoSelected(event.target.files?.[0]);
                                  event.currentTarget.value = "";
                                }}
                              />
                            </div>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="primaryColor"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Color del botón de inicio de sesión</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Selecciona un color" /></SelectTrigger></FormControl>
                              <SelectContent>
                                {buttonPalette.map((color) => (
                                  <SelectItem key={color.value} value={color.value}>{color.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="sidebarBackgroundColor"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Fondo del menu lateral</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Selecciona un color" /></SelectTrigger></FormControl>
                              <SelectContent>
                                {sidebarPalette.map((color) => (
                                  <SelectItem key={color.value} value={color.value}>{color.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="sidebarTextColor"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Color del texto del menu</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Selecciona un color" /></SelectTrigger></FormControl>
                              <SelectContent>
                                {textPalette.map((color) => (
                                  <SelectItem key={color.value} value={color.value}>{color.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="hasMochilasAccess"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-start gap-3 rounded-xl border px-4 py-3">
                            <input
                              id="tenant-has-mochilas-access"
                              type="checkbox"
                              className="mt-1 h-4 w-4 rounded border-slate-300"
                              checked={field.value}
                              onChange={(event) => field.onChange(event.target.checked)}
                            />
                            <div className="space-y-1">
                              <FormLabel htmlFor="tenant-has-mochilas-access" className="cursor-pointer text-sm font-semibold text-slate-900">
                                Buscar mochilas
                              </FormLabel>
                              <p className="text-xs text-slate-500">
                                Permite que los tickets de consulta busquen datos del alumno en la base de datos de Mochilas usando su correo.
                              </p>
                            </div>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="hasOrderLookup"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-start gap-3 rounded-xl border px-4 py-3">
                            <input
                              id="tenant-has-order-lookup"
                              type="checkbox"
                              className="mt-1 h-4 w-4 rounded border-slate-300"
                              checked={field.value}
                              onChange={(event) => field.onChange(event.target.checked)}
                            />
                            <div className="space-y-1">
                              <FormLabel htmlFor="tenant-has-order-lookup" className="cursor-pointer text-sm font-semibold text-slate-900">
                                Buscar pedidos
                              </FormLabel>
                              <p className="text-xs text-slate-500">
                                Permite que los tickets de consulta busquen informacion en Mochilas usando el numero de pedido.
                              </p>
                            </div>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="hasReturnsAccess"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-start gap-3 rounded-xl border px-4 py-3">
                            <input
                              id="tenant-has-returns-access"
                              type="checkbox"
                              className="mt-1 h-4 w-4 rounded border-slate-300"
                              checked={field.value}
                              onChange={(event) => field.onChange(event.target.checked)}
                            />
                            <div className="space-y-1">
                              <FormLabel htmlFor="tenant-has-returns-access" className="cursor-pointer text-sm font-semibold text-slate-900">
                                Activar devoluciones
                              </FormLabel>
                              <p className="text-xs text-slate-500">
                                Muestra acciones de devolucion por linea al revisar mochilas o pedidos dentro de los tickets.
                              </p>
                            </div>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="rounded-2xl border p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <LinkIcon className="h-4 w-4" />
                        Vista previa del menu lateral
                      </div>
                      <div className="rounded-xl p-3" style={{ backgroundColor: sidebarBackgroundColor, color: sidebarTextColor }}>
                        <div className="mb-4 flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-white/95">
                            {form.watch("logoUrl") ? (
                              <img src={form.watch("logoUrl")} alt="Logotipo" className="h-full w-full object-contain p-1.5" />
                            ) : (
                              <Building2 className="h-5 w-5 opacity-70" />
                            )}
                          </div>
                          <div className="text-base font-bold leading-tight">{form.watch("name") || "Nombre del colegio"}</div>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="rounded-md px-3 py-2" style={{ backgroundColor: `${sidebarTextColor}22` }}>Tickets de consulta</div>
                          <div className="rounded-md px-3 py-2">Miembros del equipo</div>
                        </div>
                      </div>
                      <div className="mt-3">
                        <Button type="button" className="h-10 w-full text-white hover:opacity-90" style={{ backgroundColor: primaryColor }}>
                          Iniciar sesión
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-2xl border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Estructura de colegios</p>
                          <p className="text-xs text-slate-500">Define el colegio matriz y los subcolegios que forman parte de esta red educativa.</p>
                        </div>
                        <Button type="button" variant="outline" className="gap-2" onClick={addSchool}>
                          <Plus className="h-4 w-4" />
                          Anadir subcolegio
                        </Button>
                      </div>

                      {schools.length === 0 ? (
                        <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-slate-500">
                          Todavia no hay subcolegios configurados. Puedes guardar solo la red educativa principal o anadir ahora sus centros asociados.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {schools.map((school, index) => (
                            <div key={school.localId} className="rounded-xl border p-4">
                              <div className="mb-4 flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">Colegio {index + 1}</p>
                                  <p className="text-xs text-slate-500">{school.isHeadquarters ? "Colegio matriz" : "Subcolegio de la red"}</p>
                                </div>
                                <Button type="button" variant="ghost" size="icon" onClick={() => removeSchool(school.localId)}>
                                  <Trash2 className="h-4 w-4 text-slate-500" />
                                </Button>
                              </div>
                              <div className="grid gap-4 md:grid-cols-[1.3fr_0.8fr_auto]">
                                <Input
                                  placeholder="Ej. Antamira"
                                  value={school.name}
                                  onChange={(event) => updateSchool(school.localId, { name: event.target.value })}
                                />
                                <Input
                                  placeholder="Codigo interno"
                                  value={school.code}
                                  onChange={(event) => updateSchool(school.localId, { code: event.target.value })}
                                />
                                <Button
                                  type="button"
                                  variant={school.isHeadquarters ? "default" : "outline"}
                                  onClick={() => updateSchool(school.localId, { isHeadquarters: !school.isHeadquarters })}
                                >
                                  {school.isHeadquarters ? "Matriz" : "Marcar matriz"}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 rounded-2xl border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Accesos directos</p>
                          <p className="text-xs text-slate-500">Anade enlaces a plataformas del cliente con su icono y URL.</p>
                        </div>
                        <Button type="button" variant="outline" className="gap-2" onClick={addQuickLink}>
                          <Plus className="h-4 w-4" />
                          Anadir acceso
                        </Button>
                      </div>

                      {quickLinks.length === 0 ? (
                        <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-slate-500">
                          Todavia no hay accesos directos. Pulsa en "Anadir acceso" para crear uno.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {quickLinks.map((link, index) => (
                            <div key={link.id} className="rounded-xl border p-4">
                              <div className="mb-4 flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-slate-900">Acceso directo {index + 1}</p>
                                <Button type="button" variant="ghost" size="icon" onClick={() => removeQuickLink(link.id)}>
                                  <Trash2 className="h-4 w-4 text-slate-500" />
                                </Button>
                              </div>
                              <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr_auto]">
                                <Input
                                  placeholder="Ej. MEE Platform (o dejalo vacio y se generara desde la URL)"
                                  value={link.label}
                                  onChange={(event) => updateQuickLink(link.id, { label: event.target.value })}
                                />
                                <div className="relative">
                                  <ExternalLink className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                  <Input
                                    className="pl-9"
                                    placeholder="https://plataforma.macmillan.es"
                                    value={link.url}
                                    onChange={(event) => updateQuickLink(link.id, { url: event.target.value })}
                                  />
                                </div>
                                <label htmlFor={`quick-link-icon-${link.id}`} className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50">
                                  <Upload className="h-4 w-4" />
                                  <span>Subir icono</span>
                                </label>
                                <input
                                  id={`quick-link-icon-${link.id}`}
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(event) => {
                                    onShortcutIconSelected(link.id, event.target.files?.[0]);
                                    event.currentTarget.blur();
                                    event.currentTarget.value = "";
                                  }}
                                />
                              </div>
                              <div className="mt-3 flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-white">
                                  {link.previewUrl || link.icon ? (
                                    link.previewUrl || isQuickLinkImage(link.icon) ? (
                                      <img src={link.previewUrl || link.icon.trim()} alt={link.label || "Icono"} className="h-6 w-6 object-contain" />
                                    ) : (
                                      <span className="text-xs font-semibold text-slate-500">{normalizeQuickLinkIcon(link.icon)}</span>
                                    )
                                  ) : (
                                    <LinkIcon className="h-5 w-5 text-slate-400" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-900">{link.label || "Nombre del acceso"}</p>
                                  <p className="truncate text-xs text-slate-500">{link.url || "Sin URL configurada"}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <DialogFooter className="border-t bg-white px-6 py-4">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                    <Button type="submit" disabled={isSaving}>
                      {isSaving ? "Guardando..." : editingTenant ? "Guardar cambios" : "Crear colegio"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="flex gap-4 p-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar clientes por nombre, dominio o correo..."
            className="w-full max-w-md pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </Card>

      <div className="overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-slate-900">
        <Table>
          <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
            <TableRow>
              <TableHead className="font-semibold">Nombre del Colegio</TableHead>
              <TableHead className="font-semibold">Estado</TableHead>
              <TableHead className="text-center font-semibold">Usuarios</TableHead>
              <TableHead className="text-center font-semibold">Tickets Abiertos</TableHead>
              <TableHead className="text-center font-semibold">Total Tickets</TableHead>
              <TableHead className="text-right font-semibold">Creado</TableHead>
              <TableHead className="text-right font-semibold">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><div className="h-5 w-48 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></TableCell>
                  <TableCell><div className="h-6 w-16 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" /></TableCell>
                  <TableCell><div className="mx-auto h-5 w-10 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></TableCell>
                  <TableCell><div className="mx-auto h-5 w-10 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></TableCell>
                  <TableCell><div className="mx-auto h-5 w-10 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></TableCell>
                  <TableCell><div className="ml-auto h-5 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></TableCell>
                  <TableCell><div className="ml-auto h-8 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></TableCell>
                </TableRow>
              ))
            ) : tenantsData?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-48 text-center text-slate-500">
                  No se encontraron colegios.
                </TableCell>
              </TableRow>
            ) : (
              tenantsData?.data.map((tenant) => (
                <TableRow key={tenant.id} className="group">
                  <TableCell>
                      <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">
                        {tenant.logoUrl ? (
                          <img src={tenant.logoUrl} alt={tenant.name} className="h-full w-full object-contain p-1.5" />
                        ) : (
                          <Building2 className="h-5 w-5" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">{tenant.name}</div>
                        <div className="text-xs text-slate-500">
                          {tenant.slug} · {(tenant.schools ?? []).filter((school) => school.active).length} colegios asociados
                          {tenant.hasMochilasAccess ? " · Buscar mochilas" : ""}
                          {tenant.hasOrderLookup ? " · Buscar pedidos" : ""}
                          {tenant.hasReturnsAccess ? " · Activar devoluciones" : ""}
                        </div>
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
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => openEditDialog(tenant as TenantRow)}>
                        <Pencil className="h-4 w-4" />
                        Editar
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="outline" size="sm" className="gap-2">
                            <Power className="h-4 w-4" />
                            {tenant.active ? "Eliminar" : "Reactivar"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{tenant.active ? "Desactivar colegio" : "Reactivar colegio"}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {tenant.active
                                ? "Se desactivara el acceso del colegio y quedara fuera de operacion hasta reactivarlo."
                                : "El colegio volvera a estar operativo y visible para su equipo."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => setTenantActive(tenant as TenantRow, !tenant.active)}>
                              {tenant.active ? "Desactivar" : "Reactivar"}
                            </AlertDialogAction>
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

        {tenantsData && tenantsData.totalPages > 1 && (
          <div className="flex items-center justify-between border-t bg-slate-50/50 p-4 dark:bg-slate-900/50">
            <span className="text-sm text-slate-500">
              Mostrando {(page - 1) * 20 + 1}-{Math.min(page * 20, tenantsData.total)} de {tenantsData.total}
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
