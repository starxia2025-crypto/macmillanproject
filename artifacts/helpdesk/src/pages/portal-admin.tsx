import { useState } from "react";
import { CreateDocumentRequestType, useCreateDocument, useGetMe, useListDocuments, useListTenants } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Search, Book, Video, HelpCircle, Link as LinkIcon, FileText, FileDown, Plus } from "lucide-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const typeLabels: Record<string, string> = {
  video: "Vídeo",
  faq: "FAQ",
  link: "Enlace",
  manual: "Manual",
  tutorial: "Tutorial",
  other: "Otro",
};

const createDocumentSchema = z.object({
  title: z.string().min(2, "Indica un título"),
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

export default function PortalAdmin() {
  const { data: user } = useGetMe();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [open, setOpen] = useState(false);

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

  const createDocument = useCreateDocument({
    mutation: {
      onSuccess: async () => {
        setOpen(false);
        form.reset();
        await refetch();
      },
    },
  });

  const canManageContent = ["superadmin", "admin_cliente", "tecnico", "manager"].includes(user?.role || "");

  function onSubmit(values: CreateDocumentValues) {
    createDocument.mutate({
      data: {
        title: values.title,
        description: values.description || null,
        type: values.type as CreateDocumentRequestType,
        category: values.category || null,
        url: values.url || null,
        content: values.content || null,
        tenantId: user?.role === "superadmin" || user?.role === "tecnico" ? values.tenantId! : (user?.tenantId as number),
        tags: values.tags ? values.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [],
        visibleToRoles: ["usuario_cliente", "visor_cliente", "manager", "tecnico", "admin_cliente", "superadmin"],
        published: values.published,
      },
    });
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

  const categories = ["all", ...Array.from(new Set(docsData?.data.map((doc) => doc.category).filter(Boolean) as string[]))];

  return (
    <div className="space-y-8">
      <div className="bg-primary text-primary-foreground rounded-2xl p-8 md:p-12 relative overflow-hidden shadow-lg">
        <div className="absolute inset-0 z-0 opacity-10">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid-portal" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke="currentColor" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid-portal)" />
          </svg>
        </div>

        <div className="relative z-10 max-w-3xl mx-auto text-center space-y-6">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Centro de ayuda Macmillan</h1>
          <p className="text-primary-foreground/80 text-lg">Publica manuales, vídeos, enlaces y respuestas frecuentes para cada cliente desde el mismo portal.</p>

          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <Input
              className="h-14 pl-12 text-lg rounded-full bg-white/10 border-white/20 text-white placeholder:text-white/50 focus-visible:ring-white/30 shadow-inner"
              placeholder="Buscar artículos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {canManageContent && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Subir contenido
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Nuevo contenido de ayuda</DialogTitle>
                  <DialogDescription>Publica manuales, vídeos, FAQs o enlaces útiles para el cliente.</DialogDescription>
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
                            <Select onValueChange={(value) => field.onChange(parseInt(value, 10))} defaultValue={field.value?.toString()}>
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField control={form.control} name="title" render={({ field }) => (
                        <FormItem><FormLabel>Título</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="type" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField control={form.control} name="category" render={({ field }) => (
                        <FormItem><FormLabel>Categoría</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="url" render={({ field }) => (
                        <FormItem><FormLabel>URL externa</FormLabel><FormControl><Input placeholder="https://..." {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="description" render={({ field }) => (
                      <FormItem><FormLabel>Descripción</FormLabel><FormControl><Textarea className="min-h-[90px]" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="content" render={({ field }) => (
                      <FormItem><FormLabel>Contenido</FormLabel><FormControl><Textarea className="min-h-[120px]" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="tags" render={({ field }) => (
                      <FormItem><FormLabel>Tags</FormLabel><FormControl><Input placeholder="excel, activacion, acceso" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                      <Button type="submit" disabled={createDocument.isPending}>Publicar</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        <div className="w-full md:w-64 shrink-0 space-y-2">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-slate-500 mb-4 px-3">Categorías</h3>
          <div className="flex md:flex-col flex-wrap gap-1">
            {categories.map((category) => (
              <Button
                key={category}
                variant={activeCategory === category ? "secondary" : "ghost"}
                className={`justify-start capitalize ${activeCategory === category ? "bg-primary/10 text-primary font-semibold" : "text-slate-600 hover:text-slate-900"}`}
                onClick={() => setActiveCategory(category)}
              >
                {category === "all" ? "Todos" : category}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1">
          {isLoading ? (
            <div className="grid sm:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />)}
            </div>
          ) : docsData?.data.length === 0 ? (
            <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-dashed">
              <HelpCircle className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-1">No se encontraron artículos</h3>
              <p className="text-slate-500">No hay contenido que coincida con tu búsqueda.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {docsData.data.map((doc) => (
                <a
                  key={doc.id}
                  href={doc.url || "#"}
                  target={doc.url ? "_blank" : undefined}
                  rel={doc.url ? "noopener noreferrer" : undefined}
                  className="block group"
                >
                  <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all duration-200 bg-white dark:bg-slate-900">
                    <CardContent className="p-5 flex gap-4">
                      <div className="shrink-0 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg group-hover:bg-primary/5 transition-colors">
                        {getIcon(doc.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="text-[10px] h-5 font-medium px-1.5 uppercase tracking-wider">
                            {typeLabels[doc.type] || doc.type}
                          </Badge>
                          {doc.category && <span className="text-xs text-slate-400 capitalize">{doc.category}</span>}
                        </div>
                        <h3 className="font-semibold text-slate-900 dark:text-white leading-tight group-hover:text-primary transition-colors line-clamp-2">
                          {doc.title}
                        </h3>
                        {doc.description && <p className="text-sm text-slate-500 mt-1 line-clamp-2">{doc.description}</p>}
                      </div>
                    </CardContent>
                  </Card>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
