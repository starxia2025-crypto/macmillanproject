import { useMemo, useState } from "react";
import { useGetMe, useListDocuments, useListTenants } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Search, Book, Video, HelpCircle, Link as LinkIcon, FileText, FileDown, Plus, Upload, Pencil, Trash2 } from "lucide-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { buildApiUrl } from "@/lib/api-base-url";

const typeLabels: Record<string, string> = {
  video: "Video",
  faq: "FAQ",
  link: "Enlace",
  manual: "Manual",
  tutorial: "Tutorial",
  other: "Otro",
};

const createDocumentSchema = z.object({
  title: z.string().min(2, "Indica un titulo"),
  description: z.string().optional(),
  type: z.enum(["manual", "tutorial", "video", "faq", "link", "other"]),
  category: z.string().optional(),
  url: z.string().optional(),
  content: z.string().optional(),
  tenantId: z.coerce.number().optional(),
  tags: z.string().optional(),
  published: z.boolean().default(true),
});

type CreateDocumentValues = z.infer<typeof createDocumentSchema>;

type UploadedFileResult = {
  fileName: string;
  storedFileName: string;
  size: number;
  mimeType: string;
  url: string;
  tenantId: number;
};

export default function PortalAdmin() {
  const { data: user } = useGetMe();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [editingDocumentId, setEditingDocumentId] = useState<number | null>(null);

  const { data: docsData, isLoading, refetch } = useListDocuments({
    tenantId: user?.role === "superadmin" ? undefined : user?.tenantId,
    search: search || undefined,
    category: activeCategory !== "all" ? activeCategory : undefined,
    limit: 50,
  });

  const { data: tenants } = useListTenants(
    { limit: 100 },
    { query: { enabled: user?.role === "superadmin" || user?.role === "tecnico" } },
  );

  const form = useForm<CreateDocumentValues>({
    resolver: zodResolver(createDocumentSchema),
    defaultValues: {
      title: "",
      description: "",
      type: "manual",
      category: "general",
      url: "",
      content: "",
      tenantId: user?.tenantId ?? undefined,
      tags: "",
      published: true,
    },
  });

  const canManageContent = ["superadmin", "admin_cliente", "tecnico", "manager"].includes(user?.role || "");
  const documents = docsData?.data ?? [];
  const tenantConfig = user as any;
  const portalHeroColor =
    tenantConfig?.tenantPrimaryColor ||
    tenantConfig?.tenantSidebarBackgroundColor ||
    "#4f46e5";

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(documents.map((doc) => doc.category).filter(Boolean) as string[]))],
    [documents],
  );

  function resetComposer() {
    setEditingDocumentId(null);
    setSelectedFile(null);
    form.reset({
      title: "",
      description: "",
      type: "manual",
      category: "general",
      url: "",
      content: "",
      tenantId: user?.tenantId ?? undefined,
      tags: "",
      published: true,
    });
  }

  function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);

    if (!file) {
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "Archivo demasiado grande",
        description: "Sube archivos de hasta 10 MB para el portal.",
        variant: "destructive",
      });
      setSelectedFile(null);
      event.target.value = "";
      return;
    }

    if (!form.getValues("title")) {
      form.setValue("title", file.name.replace(/\.[^.]+$/, ""), { shouldValidate: true });
    }
    if (!form.getValues("description")) {
      form.setValue("description", `Archivo adjunto: ${file.name}`);
    }
    form.setValue("type", "manual");
  }

  async function uploadSelectedFile(tenantId: number): Promise<UploadedFileResult | null> {
    if (!selectedFile) return null;

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("tenantId", String(tenantId));

    const response = await fetch(buildApiUrl("/api/documents/upload"), {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message = payload?.message || `No se pudo subir el archivo (${response.status}).`;
      throw new Error(message);
    }

    return payload as UploadedFileResult;
  }

  async function onSubmit(values: CreateDocumentValues) {
    const tenantId = user?.role === "superadmin" || user?.role === "tecnico" ? values.tenantId! : (user?.tenantId as number);

    try {
      const uploadedFile = await uploadSelectedFile(tenantId);
      const resolvedUrl = uploadedFile?.url || values.url || null;
      const resolvedContent = uploadedFile
        ? [values.content?.trim(), `Archivo adjunto: ${uploadedFile.fileName}`].filter(Boolean).join("\n\n")
        : (values.content || null);
      const response = await fetch(buildApiUrl(editingDocumentId ? `/api/documents/${editingDocumentId}` : "/api/documents"), {
        method: editingDocumentId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          description: values.description || (uploadedFile ? `Descarga disponible: ${uploadedFile.fileName}` : null),
          type: values.type,
          category: values.category || null,
          url: resolvedUrl,
          content: resolvedContent,
          tenantId,
          tags: values.tags ? values.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [],
          visibleToRoles: ["usuario_cliente", "visor_cliente", "manager", "tecnico", "admin_cliente", "superadmin"],
          published: values.published,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || "Se ha producido un error interno en el servidor.");
      }

      toast({
        title: editingDocumentId ? "Contenido actualizado" : "Contenido publicado",
        description: editingDocumentId ? "Los cambios ya estan guardados." : "El recurso ya esta disponible en el portal.",
      });
      setOpen(false);
      resetComposer();
      await refetch();
    } catch (error) {
      toast({
        title: "No se pudo publicar el contenido",
        description: error instanceof Error ? error.message : "Revisa el archivo e intentalo de nuevo.",
        variant: "destructive",
      });
    }
  }

  function openEditDialog(doc: any) {
    setEditingDocumentId(doc.id);
    setSelectedFile(null);
    form.reset({
      title: doc.title || "",
      description: doc.description || "",
      type: doc.type || "manual",
      category: doc.category || "general",
      url: doc.url || "",
      content: doc.content || "",
      tenantId: doc.tenantId ?? user?.tenantId ?? undefined,
      tags: Array.isArray(doc.tags) ? doc.tags.join(", ") : "",
      published: doc.published ?? true,
    });
    setOpen(true);
  }

  async function deleteDocument(documentId: number) {
    if (!window.confirm("¿Eliminar este contenido del centro de ayuda?")) return;

    try {
      const response = await fetch(buildApiUrl(`/api/documents/${documentId}`), {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo eliminar el contenido.");
      }

      toast({
        title: "Contenido eliminado",
        description: "El recurso ya no aparece en el portal.",
      });
      await refetch();
    } catch (error) {
      toast({
        title: "No se pudo eliminar el contenido",
        description: error instanceof Error ? error.message : "Intentalo de nuevo.",
        variant: "destructive",
      });
    }
  }

  const getIcon = (type: string) => {
    switch (type) {
      case "video": return <Video className="h-8 w-8 text-rose-500" />;
      case "faq": return <HelpCircle className="h-8 w-8 text-amber-500" />;
      case "link": return <LinkIcon className="h-8 w-8 text-sky-500" />;
      case "manual": return <Book className="h-8 w-8 text-indigo-500" />;
      case "tutorial": return <FileText className="h-8 w-8 text-emerald-500" />;
      default: return <FileDown className="h-8 w-8 text-slate-500" />;
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="space-y-2 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-slate-950 md:text-5xl">Centro de ayuda Macmillan</h1>
          <p className="mx-auto max-w-3xl text-lg text-slate-600">
            Consulta manuales de uso, videos explicativos, enlaces utiles, preguntas frecuentes y requisitos de acceso en un solo lugar.
          </p>
        </div>

        <div
          className="relative overflow-hidden rounded-2xl p-6 text-white shadow-lg md:p-8"
          style={{ backgroundColor: portalHeroColor }}
        >
        <div className="absolute inset-0 z-0 opacity-10">
          <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid-portal" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke="currentColor" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid-portal)" />
          </svg>
        </div>

        <div className="relative z-10 mx-auto max-w-3xl space-y-5 text-center">

          <div className="relative mx-auto max-w-xl">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-14 rounded-full border-white/20 bg-white/10 pl-12 text-lg text-white shadow-inner placeholder:text-white/50 focus-visible:ring-white/30"
              placeholder="Buscar articulos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {canManageContent && (
            <Dialog
              open={open}
              onOpenChange={(nextOpen) => {
                setOpen(nextOpen);
                if (!nextOpen) {
                  resetComposer();
                }
              }}
            >
              <DialogTrigger asChild>
                <Button variant="secondary" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Subir contenido
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Nuevo contenido de ayuda</DialogTitle>
                  <DialogDescription>Publica manuales, videos, FAQs, enlaces utiles o adjunta un archivo desde tu equipo.</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    {(user?.role === "superadmin" || user?.role === "tecnico") && (
                      <FormField
                        control={form.control}
                        name="tenantId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Cliente</FormLabel>
                            <Select onValueChange={(value) => field.onChange(parseInt(value, 10))} value={field.value?.toString()}>
                              <FormControl>
                                <SelectTrigger><SelectValue placeholder="Selecciona un cliente" /></SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {tenants?.data.map((tenant) => (
                                  <SelectItem key={tenant.id} value={tenant.id.toString()}>{tenant.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <FormField control={form.control} name="title" render={({ field }) => (
                        <FormItem><FormLabel>Titulo</FormLabel><FormControl><Input placeholder="Ej. Guia de activacion" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="type" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              {Object.entries(typeLabels).map(([value, label]) => (
                                <SelectItem key={value} value={value}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <FormField control={form.control} name="category" render={({ field }) => (
                        <FormItem><FormLabel>Categoria</FormLabel><FormControl><Input placeholder="accesos, activacion, plataformas" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="url" render={({ field }) => (
                        <FormItem><FormLabel>URL externa</FormLabel><FormControl><Input placeholder="https://..." {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>

                    <div className="rounded-xl border border-dashed p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
                        <Upload className="h-4 w-4" />
                        Subir archivo desde tu equipo
                      </div>
                      <Input type="file" onChange={handleFileSelection} />
                      <p className="mt-2 text-xs text-slate-500">Puedes adjuntar PDF, Word, Excel, imagenes u otros recursos de hasta 10 MB.</p>
                      {selectedFile && (
                        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          Archivo seleccionado: {selectedFile.name}
                        </div>
                      )}
                    </div>

                    <FormField control={form.control} name="description" render={({ field }) => (
                      <FormItem><FormLabel>Descripcion</FormLabel><FormControl><Textarea className="min-h-[90px]" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="content" render={({ field }) => (
                      <FormItem><FormLabel>Contenido</FormLabel><FormControl><Textarea className="min-h-[120px]" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="tags" render={({ field }) => (
                      <FormItem><FormLabel>Tags</FormLabel><FormControl><Input placeholder="plataforma, activacion, acceso" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                      <Button type="submit">{editingDocumentId ? "Guardar cambios" : "Publicar"}</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </div>
        </div>
      </div>

      <div className="flex flex-col gap-8 md:flex-row">
        <div className="w-full shrink-0 space-y-2 md:w-64">
          <h3 className="mb-4 px-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Categorias</h3>
          <div className="flex flex-wrap gap-1 md:flex-col">
            {categories.map((category) => (
              <Button
                key={category}
                variant={activeCategory === category ? "secondary" : "ghost"}
                className={`justify-start capitalize ${activeCategory === category ? "bg-primary/10 font-semibold text-primary" : "text-slate-600 hover:text-slate-900"}`}
                onClick={() => setActiveCategory(category)}
              >
                {category === "all" ? "Todos" : category}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1">
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}
            </div>
          ) : documents.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-slate-50 py-20 text-center dark:bg-slate-900/50">
              <HelpCircle className="mx-auto mb-4 h-12 w-12 text-slate-300" />
              <h3 className="mb-1 text-lg font-medium text-slate-900 dark:text-white">No se encontraron articulos</h3>
              <p className="text-slate-500">No hay contenido que coincida con tu busqueda.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {documents.map((doc) => {
                const isDownloadableFile = !!doc.url?.includes("/uploads/documents/");
                return (
                  <Card key={doc.id} className="h-full bg-white transition-all duration-200 hover:border-primary/50 hover:shadow-md dark:bg-slate-900">
                    <CardContent className="flex gap-4 p-5">
                      <a
                        href={doc.url || "#"}
                        target={doc.url && !isDownloadableFile ? "_blank" : undefined}
                        rel={doc.url && !isDownloadableFile ? "noopener noreferrer" : undefined}
                        download={isDownloadableFile ? doc.title : undefined}
                        className="flex min-w-0 flex-1 gap-4"
                      >
                        <div className="shrink-0 rounded-lg bg-slate-50 p-3 transition-colors group-hover:bg-primary/5 dark:bg-slate-800">
                          {getIcon(doc.type)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium uppercase tracking-wider">
                              {typeLabels[doc.type] || doc.type}
                            </Badge>
                            {doc.category && <span className="text-xs capitalize text-slate-400">{doc.category}</span>}
                            {isDownloadableFile && <span className="text-xs text-emerald-600">Descargable</span>}
                          </div>
                          <h3 className="line-clamp-2 leading-tight font-semibold text-slate-900 transition-colors group-hover:text-primary dark:text-white">
                            {doc.title}
                          </h3>
                          {doc.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{doc.description}</p>}
                        </div>
                      </a>
                      {canManageContent && (
                        <div className="flex shrink-0 flex-col gap-2">
                          <Button type="button" variant="outline" size="icon" onClick={() => openEditDialog(doc)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="outline" size="icon" onClick={() => deleteDocument(doc.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
