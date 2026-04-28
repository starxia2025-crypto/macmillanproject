import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetMe, customFetch } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AssistanceStatusBadge, PriorityBadge } from "@/components/badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { CalendarClock, CheckCircle2, Headphones, Layers3, Loader2, Phone, Video } from "lucide-react";

type AssistanceMeta = {
  schools: Array<{ id: number; tenantId: number; name: string }>;
  assistanceTypes: string[];
  reasons: string[];
  statuses: string[];
  priorities: string[];
};

type AssistanceItem = {
  id: number;
  requestNumber: string;
  status: string;
  assistanceType: string;
  reason: string;
  requesterName: string;
  requesterEmail: string;
  requestedAt: string | null;
  scheduledAt: string | null;
  priority: string | null;
  productOrService: string | null;
  description: string;
  schoolName: string | null;
  technicianName: string | null;
  createdAt: string;
};

const typeLabels: Record<string, string> = {
  telefonica: "Telefonica",
  presencial: "Presencial",
  remoto: "En remoto",
  videoconferencia: "Videoconferencia",
};

const reasonLabels: Record<string, string> = {
  incidencia: "Incidencia",
  consulta_general: "Consulta general",
  formacion_especifica: "Formacion especifica",
  ayuda_recursos_digitales: "Ayuda con recursos digitales",
  otro: "Otro",
};

const formSchema = z.object({
  assistanceType: z.enum(["telefonica", "presencial", "remoto", "videoconferencia"]),
  reason: z.enum(["incidencia", "consulta_general", "formacion_especifica", "ayuda_recursos_digitales", "otro"]),
  schoolId: z.string().optional(),
  requesterName: z.string().trim().min(2, "Indica la persona solicitante"),
  requesterPhone: z.string().trim().min(6, "Indica un telefono de contacto"),
  requesterEmail: z.string().trim().email("Indica un email valido"),
  requestedDate: z.string().optional(),
  requestedTime: z.string().optional(),
  description: z.string().trim().min(10, "Describe brevemente la ayuda que necesitas"),
  priority: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  productOrService: z.string().trim().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function combineDateTime(dateValue?: string, timeValue?: string) {
  if (!dateValue) return null;
  const safeTime = timeValue || "09:00";
  return new Date(`${dateValue}T${safeTime}:00`).toISOString();
}

export default function AssistanceRequestPage() {
  const { data: user } = useGetMe();
  const queryClient = useQueryClient();
  const [createdRequest, setCreatedRequest] = useState<{ requestNumber: string; status: string } | null>(null);

  const metaQuery = useQuery({
    queryKey: ["assistance-meta"],
    queryFn: () => customFetch<AssistanceMeta>("/api/assistance/meta", { method: "GET" }),
  });

  const myRequestsQuery = useQuery({
    queryKey: ["assistance-mine"],
    queryFn: () => customFetch<{ data: AssistanceItem[] }>("/api/assistance/requests/mine", { method: "GET" }),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      assistanceType: "telefonica",
      reason: "incidencia",
      schoolId: user?.schoolId ? String(user.schoolId) : "",
      requesterName: user?.name ?? "",
      requesterPhone: "",
      requesterEmail: user?.email ?? "",
      requestedDate: "",
      requestedTime: "",
      description: "",
      priority: "media",
      productOrService: "",
    },
  });

  useEffect(() => {
    if (!user) return;
    form.setValue("requesterName", user.name ?? "");
    form.setValue("requesterEmail", user.email ?? "");
    if (user.schoolId) {
      form.setValue("schoolId", String(user.schoolId));
    }
  }, [form, user]);

  const createMutation = useMutation({
    mutationFn: async (values: FormValues) =>
      customFetch<{ requestNumber: string; status: string }>("/api/assistance/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistanceType: values.assistanceType,
          reason: values.reason,
          schoolId: values.schoolId ? Number(values.schoolId) : null,
          requesterName: values.requesterName,
          requesterPhone: values.requesterPhone,
          requesterEmail: values.requesterEmail,
          requestedAt: combineDateTime(values.requestedDate, values.requestedTime),
          description: values.description,
          priority: values.priority,
          productOrService: values.productOrService?.trim() || null,
        }),
      }),
    onSuccess: async (result) => {
      setCreatedRequest({ requestNumber: result.requestNumber, status: result.status });
      await queryClient.invalidateQueries({ queryKey: ["assistance-mine"] });
      form.reset({
        assistanceType: "telefonica",
        reason: "incidencia",
        schoolId: user?.schoolId ? String(user.schoolId) : "",
        requesterName: user?.name ?? "",
        requesterPhone: "",
        requesterEmail: user?.email ?? "",
        requestedDate: "",
        requestedTime: "",
        description: "",
        priority: "media",
        productOrService: "",
      });
      toast({
        title: "Solicitud enviada",
        description: `Hemos registrado la asistencia ${result.requestNumber}.`,
      });
    },
    onError: (error) => {
      toast({
        title: "No se pudo enviar la solicitud",
        description: error instanceof Error ? error.message : "Revisa los datos e intentalo de nuevo.",
        variant: "destructive",
      });
    },
  });

  const schools = metaQuery.data?.schools ?? [];
  const myRequests = myRequestsQuery.data?.data ?? [];
  const selectedType = form.watch("assistanceType");
  const typeHelpText = useMemo(() => {
    switch (selectedType) {
      case "telefonica":
        return "Ideal si necesitas una llamada rapida para resolver una duda o incidencia.";
      case "presencial":
        return "Pensado para visitas al centro cuando la ayuda necesita intervencion in situ.";
      case "remoto":
        return "Recomendado para soporte tecnico guiado a distancia.";
      case "videoconferencia":
        return "Util para reuniones o formaciones online con enlace de conexion.";
      default:
        return "";
    }
  }, [selectedType]);

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-sky-50/70 p-8 shadow-sm">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
              <Headphones className="h-3.5 w-3.5" />
              Solicitar asistencia
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Pide ayuda de forma sencilla</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                Cuentanos que necesitas y el equipo de soporte planificara la mejor asistencia para tu centro.
                Hemos simplificado el formulario para que puedas completarlo sin complicaciones.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Canales</p>
              <p className="mt-2 text-sm text-slate-700">Telefonica, presencial, remoto y videoconferencia.</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Proceso guiado</p>
              <p className="mt-2 text-sm text-slate-700">Campos claros, ayuda visible y confirmacion final.</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Seguimiento</p>
              <p className="mt-2 text-sm text-slate-700">Tu solicitud queda registrada para poder consultar su estado.</p>
            </div>
          </div>
        </div>
      </section>

      {createdRequest && (
        <Card className="rounded-[1.75rem] border-emerald-200 bg-emerald-50/80 shadow-sm">
          <CardContent className="flex items-start gap-4 p-6">
            <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-600" />
            <div>
              <p className="text-lg font-semibold text-emerald-900">Solicitud registrada correctamente</p>
              <p className="mt-1 text-sm text-emerald-800">
                Hemos creado la asistencia <span className="font-semibold">{createdRequest.requestNumber}</span>. Su
                estado inicial es <span className="font-semibold">{createdRequest.status}</span>.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/40">
          <CardHeader>
            <CardTitle>Nuevo formulario de asistencia</CardTitle>
            <CardDescription>Completa solo la informacion necesaria. Nosotros nos encargamos del resto.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((values) => createMutation.mutate(values))} className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="assistanceType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tipo de asistencia</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="telefonica">Telefonica</SelectItem>
                            <SelectItem value="presencial">Presencial</SelectItem>
                            <SelectItem value="remoto">En remoto</SelectItem>
                            <SelectItem value="videoconferencia">Videoconferencia</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-slate-500">{typeHelpText}</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Motivo</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="incidencia">Incidencia</SelectItem>
                            <SelectItem value="consulta_general">Consulta general</SelectItem>
                            <SelectItem value="formacion_especifica">Formacion especifica</SelectItem>
                            <SelectItem value="ayuda_recursos_digitales">Ayuda con recursos digitales</SelectItem>
                            <SelectItem value="otro">Otro</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="schoolId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Colegio / centro asociado</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger disabled={!!user?.schoolId}>
                              <SelectValue placeholder="Selecciona un centro" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {schools.map((school) => (
                              <SelectItem key={school.id} value={String(school.id)}>
                                {school.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="productOrService"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Producto o servicio relacionado</FormLabel>
                        <FormControl>
                          <Input placeholder="Opcional, si aplica" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="requesterName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Persona solicitante</FormLabel>
                        <FormControl>
                          <Input placeholder="Nombre y apellidos" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="requesterPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Telefono de contacto</FormLabel>
                        <FormControl>
                          <Input placeholder="Telefono directo" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="requesterEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input placeholder="correo@centro.es" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prioridad orientativa</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="baja">Baja</SelectItem>
                            <SelectItem value="media">Media</SelectItem>
                            <SelectItem value="alta">Alta</SelectItem>
                            <SelectItem value="urgente">Urgente</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="requestedDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fecha solicitada</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="requestedTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Hora solicitada</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descripcion breve</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Explica de forma sencilla que necesitas, que esta ocurriendo y como te gustaria que te ayudemos."
                          className="min-h-[130px] resize-y"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-xs text-slate-500">
                        Ejemplo: “Necesitamos apoyo para revisar el acceso a recursos digitales del grupo de 2 ESO”.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end">
                  <Button type="submit" className="min-w-52 rounded-xl" disabled={createMutation.isPending}>
                    {createMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Enviando solicitud...
                      </>
                    ) : (
                      "Enviar solicitud"
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/40">
            <CardHeader>
              <CardTitle>Como funciona</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600">
              <div className="flex gap-3">
                <Phone className="mt-0.5 h-5 w-5 text-sky-600" />
                <p>Elige el canal que te resulte mas comodo para recibir asistencia.</p>
              </div>
              <div className="flex gap-3">
                <CalendarClock className="mt-0.5 h-5 w-5 text-indigo-600" />
                <p>Indica una fecha y hora orientativas si quieres que planifiquemos contigo la ayuda.</p>
              </div>
              <div className="flex gap-3">
                <Layers3 className="mt-0.5 h-5 w-5 text-violet-600" />
                <p>Cuantos mas detalles utiles nos des, mas rapido podremos asignar la asistencia adecuada.</p>
              </div>
              <div className="flex gap-3">
                <Video className="mt-0.5 h-5 w-5 text-emerald-600" />
                <p>Si eliges videoconferencia, la solicitud quedara preparada para incluir un enlace seguro cuando se programe.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/40">
            <CardHeader>
              <CardTitle>Solicitudes recientes</CardTitle>
              <CardDescription>Consulta el estado de las asistencias ya registradas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {myRequestsQuery.isLoading ? (
                <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">
                  Cargando solicitudes...
                </div>
              ) : myRequests.length === 0 ? (
                <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">
                  Todavia no has registrado ninguna solicitud de asistencia.
                </div>
              ) : (
                myRequests.slice(0, 5).map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{item.requestNumber}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {typeLabels[item.assistanceType] ?? item.assistanceType} · {reasonLabels[item.reason] ?? item.reason}
                        </p>
                      </div>
                      <AssistanceStatusBadge status={item.status} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.priority && <PriorityBadge priority={item.priority} />}
                      {item.scheduledAt && (
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                          {format(new Date(item.scheduledAt), "d MMM, HH:mm", { locale: es })}
                        </span>
                      )}
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm text-slate-600">{item.description}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
