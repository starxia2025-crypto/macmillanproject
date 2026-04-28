import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AssistanceStatusBadge, PriorityBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { CalendarDays, CalendarPlus2, Filter, Loader2, NotebookPen, RefreshCcw } from "lucide-react";

type AssistanceMeta = {
  schools: Array<{ id: number; tenantId: number; name: string }>;
  technicians: Array<{ id: number; name: string; email: string }>;
  assistanceTypes: string[];
  reasons: string[];
  statuses: string[];
  priorities: string[];
};

type AssistanceSupportItem = {
  id: number;
  requestNumber: string;
  status: string;
  assistanceType: string;
  reason: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string | null;
  requestedAt: string | null;
  scheduledAt: string | null;
  priority: string | null;
  productOrService: string | null;
  description: string;
  internalObservations: string | null;
  meetingProvider: string | null;
  meetingUrl: string | null;
  meetingId: string | null;
  meetingNotes: string | null;
  schoolName: string | null;
  tenantName: string | null;
  technicianName: string | null;
  assignedToId: number | null;
  createdAt: string;
  updatedAt: string;
};

type AssistanceDetail = AssistanceSupportItem & {
  notes: Array<{
    id: number;
    noteType: string;
    content: string;
    createdAt: string;
    authorName: string;
  }>;
};

const typeLabels: Record<string, string> = {
  telefonica: "Telefonica",
  presencial: "Presencial",
  remoto: "En remoto",
  videoconferencia: "Videoconferencia",
};

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  aceptada: "Aceptada",
  programada: "Programada",
  en_curso: "En curso",
  completada: "Completada",
  cancelada: "Cancelada",
  rechazada: "Rechazada",
};

export default function AssistanceInboxPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    status: "all",
    assistanceType: "all",
    priority: "all",
    schoolId: "all",
    dateFrom: "",
    dateTo: "",
  });
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [editState, setEditState] = useState({
    status: "pendiente",
    assignedToId: "unassigned",
    scheduledDate: "",
    scheduledTime: "",
    internalObservations: "",
    meetingProvider: "ninguno",
    meetingUrl: "",
    meetingId: "",
    meetingNotes: "",
  });
  const [internalNote, setInternalNote] = useState("");

  const metaQuery = useQuery({
    queryKey: ["assistance-meta-support"],
    queryFn: () => customFetch<AssistanceMeta>("/api/assistance/meta", { method: "GET" }),
  });

  const supportQuery = useQuery({
    queryKey: ["assistance-support", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.status !== "all") params.set("status", filters.status);
      if (filters.assistanceType !== "all") params.set("assistanceType", filters.assistanceType);
      if (filters.priority !== "all") params.set("priority", filters.priority);
      if (filters.schoolId !== "all") params.set("schoolId", filters.schoolId);
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) params.set("dateTo", filters.dateTo);
      params.set("limit", "150");
      return customFetch<{ data: AssistanceSupportItem[] }>(`/api/assistance/requests/support?${params.toString()}`, { method: "GET" });
    },
  });

  const detailQuery = useQuery({
    queryKey: ["assistance-detail", selectedRequestId],
    queryFn: () => customFetch<AssistanceDetail>(`/api/assistance/requests/${selectedRequestId}`, { method: "GET" }),
    enabled: !!selectedRequestId,
  });

  useEffect(() => {
    if (!detailQuery.data) return;
    const scheduledAt = detailQuery.data.scheduledAt ? new Date(detailQuery.data.scheduledAt) : null;
    setEditState({
      status: detailQuery.data.status,
      assignedToId: detailQuery.data.assignedToId ? String(detailQuery.data.assignedToId) : "unassigned",
      scheduledDate: scheduledAt ? format(scheduledAt, "yyyy-MM-dd") : "",
      scheduledTime: scheduledAt ? format(scheduledAt, "HH:mm") : "",
      internalObservations: detailQuery.data.internalObservations ?? "",
      meetingProvider: detailQuery.data.meetingProvider ?? "ninguno",
      meetingUrl: detailQuery.data.meetingUrl ?? "",
      meetingId: detailQuery.data.meetingId ?? "",
      meetingNotes: detailQuery.data.meetingNotes ?? "",
    });
  }, [detailQuery.data]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const scheduledAt = editState.scheduledDate
        ? new Date(`${editState.scheduledDate}T${editState.scheduledTime || "09:00"}:00`).toISOString()
        : null;
      return customFetch(`/api/assistance/requests/${selectedRequestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editState.status,
          assignedToId: editState.assignedToId === "unassigned" ? null : Number(editState.assignedToId),
          scheduledAt,
          internalObservations: editState.internalObservations || null,
          meetingProvider: editState.meetingProvider || null,
          meetingUrl: editState.meetingUrl || null,
          meetingId: editState.meetingId || null,
          meetingNotes: editState.meetingNotes || null,
        }),
      });
    },
    onSuccess: async () => {
      toast({ title: "Solicitud actualizada", description: "Los cambios se han guardado correctamente." });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["assistance-support"] }),
        queryClient.invalidateQueries({ queryKey: ["assistance-detail", selectedRequestId] }),
      ]);
    },
    onError: (error) => {
      toast({
        title: "No se pudo actualizar la solicitud",
        description: error instanceof Error ? error.message : "Intentalo de nuevo.",
        variant: "destructive",
      });
    },
  });

  const noteMutation = useMutation({
    mutationFn: async () =>
      customFetch(`/api/assistance/requests/${selectedRequestId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: internalNote }),
      }),
    onSuccess: async () => {
      setInternalNote("");
      toast({ title: "Observacion guardada", description: "La nota interna ya esta disponible en el historial." });
      await queryClient.invalidateQueries({ queryKey: ["assistance-detail", selectedRequestId] });
    },
    onError: (error) => {
      toast({
        title: "No se pudo guardar la observacion",
        description: error instanceof Error ? error.message : "Intentalo de nuevo.",
        variant: "destructive",
      });
    },
  });

  const rows = supportQuery.data?.data ?? [];
  const meta = metaQuery.data;
  const groupedAgenda = useMemo(() => {
    const groups = new Map<string, AssistanceSupportItem[]>();
    for (const item of rows) {
      const baseDate = item.scheduledAt || item.requestedAt || item.createdAt;
      const key = format(new Date(baseDate), "yyyy-MM-dd");
      const current = groups.get(key) ?? [];
      current.push(item);
      groups.set(key, current);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  function downloadIcs(requestId: number) {
    window.open(`/api/assistance/requests/${requestId}/ics`, "_blank");
  }

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-indigo-50/70 p-8 shadow-sm">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-700">
              <CalendarDays className="h-3.5 w-3.5" />
              Bandeja de asistencias
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Agenda operativa de soporte</h1>
              <p className="mt-2 max-w-3xl text-base text-slate-600">
                Revisa solicitudes pendientes, programa asistencias, asigna tecnico y mantén trazabilidad clara para el
                equipo de soporte Macmillan.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Total visibles</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{rows.length}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Pendientes</p>
              <p className="mt-2 text-3xl font-semibold text-amber-600">{rows.filter((row) => row.status === "pendiente").length}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Programadas</p>
              <p className="mt-2 text-3xl font-semibold text-indigo-600">{rows.filter((row) => row.status === "programada").length}</p>
            </div>
          </div>
        </div>
      </section>

      <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/40">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Filtros operativos</CardTitle>
            <CardDescription>Acota la bandeja por tipo, estado, colegio, prioridad o fecha.</CardDescription>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => supportQuery.refetch()}>
            <RefreshCcw className="h-4 w-4" />
            Actualizar
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-6">
          <div className="space-y-2">
            <Label>Estado</Label>
            <Select value={filters.status} onValueChange={(value) => setFilters((current) => ({ ...current, status: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {meta?.statuses.map((status) => (
                  <SelectItem key={status} value={status}>{statusLabels[status] ?? status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={filters.assistanceType} onValueChange={(value) => setFilters((current) => ({ ...current, assistanceType: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {meta?.assistanceTypes.map((type) => (
                  <SelectItem key={type} value={type}>{typeLabels[type] ?? type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Prioridad</Label>
            <Select value={filters.priority} onValueChange={(value) => setFilters((current) => ({ ...current, priority: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {meta?.priorities.map((priority) => (
                  <SelectItem key={priority} value={priority}>{priority}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Colegio</Label>
            <Select value={filters.schoolId} onValueChange={(value) => setFilters((current) => ({ ...current, schoolId: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {meta?.schools.map((school) => (
                  <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Desde</Label>
            <Input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Hasta</Label>
            <Input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="agenda" className="space-y-5">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="agenda">Agenda</TabsTrigger>
          <TabsTrigger value="listado">Listado</TabsTrigger>
        </TabsList>

        <TabsContent value="agenda" className="space-y-4">
          {supportQuery.isLoading ? (
            <Card className="rounded-[1.75rem] border-slate-200/80 shadow-sm">
              <CardContent className="px-6 py-10 text-center text-sm text-slate-500">Cargando agenda...</CardContent>
            </Card>
          ) : groupedAgenda.length === 0 ? (
            <Card className="rounded-[1.75rem] border-slate-200/80 shadow-sm">
              <CardContent className="px-6 py-10 text-center text-sm text-slate-500">No hay asistencias para los filtros seleccionados.</CardContent>
            </Card>
          ) : (
            groupedAgenda.map(([dateKey, items]) => (
              <Card key={dateKey} className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/30">
                <CardHeader>
                  <CardTitle className="text-xl">
                    {format(new Date(`${dateKey}T00:00:00`), "EEEE d 'de' MMMM", { locale: es })}
                  </CardTitle>
                  <CardDescription>{items.length} solicitud(es) previstas o registradas en esta fecha.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedRequestId(item.id)}
                      className="grid w-full gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/30 lg:grid-cols-[130px_1fr_180px_160px]"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {item.scheduledAt ? format(new Date(item.scheduledAt), "HH:mm") : "Sin hora"}
                        </p>
                        <p className="text-xs text-slate-500">{typeLabels[item.assistanceType] ?? item.assistanceType}</p>
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{item.schoolName || item.tenantName || item.requesterName}</p>
                        <p className="mt-1 text-sm text-slate-500">{item.requesterName}</p>
                        <p className="mt-1 text-sm text-slate-500">{item.requestNumber}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <AssistanceStatusBadge status={item.status} />
                        {item.priority && <PriorityBadge priority={item.priority} />}
                      </div>
                      <div className="text-sm text-slate-600">
                        <p className="font-medium text-slate-800">{item.technicianName || "Sin asignar"}</p>
                        <p className="mt-1">{item.requesterEmail}</p>
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="listado">
          <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/30">
            <CardHeader>
              <CardTitle>Listado de solicitudes</CardTitle>
              <CardDescription>Vista rapida para revisar cola, asignaciones y estado.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {supportQuery.isLoading ? (
                <div className="px-6 py-10 text-center text-sm text-slate-500">Cargando solicitudes...</div>
              ) : rows.length === 0 ? (
                <div className="px-6 py-10 text-center text-sm text-slate-500">No hay resultados para los filtros seleccionados.</div>
              ) : (
                rows.map((item) => (
                  <div key={item.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm lg:grid-cols-[1.3fr_0.9fr_0.8fr_0.7fr_auto]">
                    <div>
                      <p className="font-semibold text-slate-900">{item.requestNumber}</p>
                      <p className="mt-1 text-sm text-slate-600">{item.schoolName || item.tenantName || "-"}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.requesterName}</p>
                    </div>
                    <div className="text-sm text-slate-600">
                      <p>{typeLabels[item.assistanceType] ?? item.assistanceType}</p>
                      <p className="mt-1">{item.scheduledAt ? format(new Date(item.scheduledAt), "d MMM, HH:mm", { locale: es }) : "Sin programar"}</p>
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      <AssistanceStatusBadge status={item.status} />
                      {item.priority && <PriorityBadge priority={item.priority} />}
                    </div>
                    <div className="text-sm text-slate-600">
                      <p>{item.technicianName || "Sin asignar"}</p>
                    </div>
                    <div className="flex justify-end">
                      <Button variant="outline" onClick={() => setSelectedRequestId(item.id)}>Abrir detalle</Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedRequestId} onOpenChange={(open) => !open && setSelectedRequestId(null)}>
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle de asistencia</DialogTitle>
            <DialogDescription>Gestiona la solicitud, asigna tecnico, programa la agenda y registra observaciones internas.</DialogDescription>
          </DialogHeader>

          {detailQuery.isLoading || !detailQuery.data ? (
            <div className="py-10 text-center text-sm text-slate-500">Cargando detalle...</div>
          ) : (
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-5">
                <Card className="rounded-2xl border-slate-200/80 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-xl">{detailQuery.data.requestNumber}</CardTitle>
                    <CardDescription>{detailQuery.data.schoolName || detailQuery.data.tenantName || "-"}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Solicitante</p>
                      <p className="mt-1 text-sm text-slate-700">{detailQuery.data.requesterName}</p>
                      <p className="mt-1 text-sm text-slate-500">{detailQuery.data.requesterEmail}</p>
                      {detailQuery.data.requesterPhone && <p className="mt-1 text-sm text-slate-500">{detailQuery.data.requesterPhone}</p>}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Tipo y motivo</p>
                      <p className="mt-1 text-sm text-slate-700">{typeLabels[detailQuery.data.assistanceType] ?? detailQuery.data.assistanceType}</p>
                      <p className="mt-1 text-sm text-slate-500">{detailQuery.data.reason}</p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Descripcion</p>
                      <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-700">{detailQuery.data.description}</p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border-slate-200/80 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-lg">Historial interno</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Nueva observacion interna</Label>
                      <Textarea
                        value={internalNote}
                        onChange={(event) => setInternalNote(event.target.value)}
                        placeholder="Anade notas para el equipo de soporte."
                        className="min-h-[120px]"
                      />
                      <div className="flex justify-end">
                        <Button onClick={() => noteMutation.mutate()} disabled={noteMutation.isPending || internalNote.trim().length < 2}>
                          {noteMutation.isPending ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Guardando...
                            </>
                          ) : (
                            <>
                              <NotebookPen className="mr-2 h-4 w-4" />
                              Guardar observacion
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {detailQuery.data.notes.length === 0 ? (
                        <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-slate-500">
                          Todavia no hay observaciones internas.
                        </div>
                      ) : (
                        detailQuery.data.notes.map((note) => (
                          <div key={note.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-sm font-medium text-slate-900">{note.authorName}</p>
                            <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{note.content}</p>
                            <p className="mt-2 text-xs text-slate-400">{format(new Date(note.createdAt), "d MMM, HH:mm", { locale: es })}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-5">
                <Card className="rounded-2xl border-slate-200/80 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-lg">Planificacion y gestion</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Estado</Label>
                        <Select value={editState.status} onValueChange={(value) => setEditState((current) => ({ ...current, status: value }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {meta?.statuses.map((status) => (
                              <SelectItem key={status} value={status}>{statusLabels[status] ?? status}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Tecnico asignado</Label>
                        <Select value={editState.assignedToId} onValueChange={(value) => setEditState((current) => ({ ...current, assignedToId: value }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Sin asignar</SelectItem>
                            {meta?.technicians.map((technician) => (
                              <SelectItem key={technician.id} value={String(technician.id)}>{technician.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Fecha definitiva</Label>
                        <Input type="date" value={editState.scheduledDate} onChange={(event) => setEditState((current) => ({ ...current, scheduledDate: event.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <Label>Hora definitiva</Label>
                        <Input type="time" value={editState.scheduledTime} onChange={(event) => setEditState((current) => ({ ...current, scheduledTime: event.target.value }))} />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Observaciones internas</Label>
                      <Textarea
                        value={editState.internalObservations}
                        onChange={(event) => setEditState((current) => ({ ...current, internalObservations: event.target.value }))}
                        className="min-h-[110px]"
                      />
                    </div>

                    {detailQuery.data.assistanceType === "videoconferencia" && (
                      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4">
                        <p className="text-sm font-semibold text-sky-900">Datos de videoconferencia</p>
                        <p className="mt-1 text-xs text-sky-700">
                          El proyecto tiene base Microsoft/Graph en otras areas, pero esta asistencia queda preparada sin fingir una integracion real de Teams.
                        </p>
                        <div className="mt-4 grid gap-4">
                          <div className="space-y-2">
                            <Label>Proveedor</Label>
                            <Select value={editState.meetingProvider} onValueChange={(value) => setEditState((current) => ({ ...current, meetingProvider: value }))}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="teams">Teams</SelectItem>
                                <SelectItem value="externo">Enlace externo seguro</SelectItem>
                                <SelectItem value="ninguno">Sin definir</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Enlace de reunion</Label>
                            <Input value={editState.meetingUrl} onChange={(event) => setEditState((current) => ({ ...current, meetingUrl: event.target.value }))} placeholder="https://..." />
                          </div>
                          <div className="space-y-2">
                            <Label>ID de reunion</Label>
                            <Input value={editState.meetingId} onChange={(event) => setEditState((current) => ({ ...current, meetingId: event.target.value }))} />
                          </div>
                          <div className="space-y-2">
                            <Label>Notas de reunion</Label>
                            <Textarea value={editState.meetingNotes} onChange={(event) => setEditState((current) => ({ ...current, meetingNotes: event.target.value }))} className="min-h-[90px]" />
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border-slate-200/80 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-lg">Acciones rapidas</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Button className="w-full justify-start" variant="outline" onClick={() => downloadIcs(detailQuery.data.id)}>
                      <CalendarPlus2 className="mr-2 h-4 w-4" />
                      Crear recordatorio en Outlook (.ics)
                    </Button>
                    <Button className="w-full justify-start" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                      {updateMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Guardando cambios...
                        </>
                      ) : (
                        <>
                          <Filter className="mr-2 h-4 w-4" />
                          Guardar cambios de gestion
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          <DialogFooter />
        </DialogContent>
      </Dialog>
    </div>
  );
}
