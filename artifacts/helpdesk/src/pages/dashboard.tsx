import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  customFetch,
  useAssignTicket,
  useGetDashboardStats,
  useGetMe,
  useGetRecentActivity,
  useGetTenant,
  useGetTicketsOverTime,
  useListTenants,
  useListTickets,
  useListUsers,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  BadgeCheck,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock3,
  Layers3,
  School2,
  Ticket,
  UserRoundSearch,
  Users2,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { StatusBadge } from "@/components/badges";
import { toast } from "@/hooks/use-toast";

type SchoolMetric = { schoolName: string; count: number };
type InquiryMetric = { inquiryType: string; count: number };
type StageMetric = { stage: string; count: number };
type SchoolReporterMetric = { schoolName: string; reporterName: string; label: string; count: number };
type ResolutionMetric = { schoolName: string; avgHours: number; count: number };
type SchoolOption = { id: number; name: string; tenantName: string };

const openStatuses = ["nuevo", "pendiente", "en_revision", "en_proceso", "esperando_cliente"];
const palette = ["#4f46e5", "#14b8a6", "#f97316", "#8b5cf6", "#0ea5e9", "#ef4444", "#22c55e", "#64748b"];

async function getDashboardCollection<T>(
  path: string,
  filters?: { tenantId?: number; schoolId?: number; dateFrom?: string; dateTo?: string },
) {
  const params = new URLSearchParams();
  if (filters?.tenantId) params.set("tenantId", String(filters.tenantId));
  if (filters?.schoolId) params.set("schoolId", String(filters.schoolId));
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return customFetch<T>(`/api/dashboard/${path}${suffix}`, { method: "GET" });
}

function formatHours(value?: number | null) {
  if (!value || Number.isNaN(value)) return "N/D";
  return `${value.toFixed(1)} h`;
}

function truncateLabel(value: string, max = 22) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function ChartEmpty({ message }: { message: string }) {
  return <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">{message}</div>;
}

export default function Dashboard() {
  const { data: user } = useGetMe();
  const canUseGlobalFilters = user?.role === "superadmin" || user?.role === "tecnico" || user?.role === "admin_cliente" || user?.role === "visor_cliente";
  const tenantId = canUseGlobalFilters ? undefined : user?.tenantId;
  const [selectedSchoolId, setSelectedSchoolId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [openTicketsDialog, setOpenTicketsDialog] = useState(false);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<number, string>>({});

  const selectedSchoolIdNumber = canUseGlobalFilters && selectedSchoolId !== "all" ? Number(selectedSchoolId) : undefined;
  const dashboardFilters = useMemo(
    () => ({
      tenantId,
      schoolId: selectedSchoolIdNumber,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [dateFrom, dateTo, selectedSchoolIdNumber, tenantId],
  );

  const { data: tenantsData } = useListTenants(
    { page: 1, limit: 100 },
    { query: { enabled: !!user && (user?.role === "superadmin" || user?.role === "tecnico") } } as any,
  );
  const { data: currentTenantData } = useGetTenant(user?.tenantId ?? 0, {
    query: { enabled: !!user?.tenantId && (user?.role === "admin_cliente" || user?.role === "visor_cliente") },
  } as any);

  const availableSchools = useMemo(() => {
    const tenantSource = user?.role === "superadmin" || user?.role === "tecnico"
      ? (tenantsData?.data ?? [])
      : currentTenantData
        ? [currentTenantData]
        : [];

    const schools = tenantSource.flatMap((tenant: any) =>
      (tenant.schools ?? [])
        .filter((school: any) => school.active)
        .map((school: any) => ({
          id: school.id,
          name: school.name,
          tenantName: tenant.name,
        })),
    ) as SchoolOption[];

    return schools.sort((a, b) => {
      const byName = a.name.localeCompare(b.name, "es");
      return byName !== 0 ? byName : a.tenantName.localeCompare(b.tenantName, "es");
    });
  }, [currentTenantData, tenantsData?.data, user?.role]);

  const { data: stats, isLoading: statsLoading } = useGetDashboardStats(dashboardFilters, { query: { enabled: !!user } } as any);
  const { data: timeData = [] } = useGetTicketsOverTime({ ...dashboardFilters, period: "day" }, { query: { enabled: !!user } } as any);
  const { data: activity = [] } = useGetRecentActivity({ ...dashboardFilters, limit: 6 }, { query: { enabled: !!user } } as any);

  const schoolDataQuery = useQuery({
    queryKey: ["dashboard-school-metrics", user?.id, dashboardFilters.tenantId, dashboardFilters.schoolId, dashboardFilters.dateFrom, dashboardFilters.dateTo],
    enabled: !!user,
    retry: 1,
    queryFn: () => getDashboardCollection<SchoolMetric[]>("tickets-by-school", dashboardFilters),
  });
  const inquiryTypeQuery = useQuery({
    queryKey: ["dashboard-inquiry-metrics", user?.id, dashboardFilters.tenantId, dashboardFilters.schoolId, dashboardFilters.dateFrom, dashboardFilters.dateTo],
    enabled: !!user,
    retry: 1,
    queryFn: () => getDashboardCollection<InquiryMetric[]>("tickets-by-inquiry-type", dashboardFilters),
  });
  const stageQuery = useQuery({
    queryKey: ["dashboard-stage-metrics", user?.id, dashboardFilters.tenantId, dashboardFilters.schoolId, dashboardFilters.dateFrom, dashboardFilters.dateTo],
    enabled: !!user,
    retry: 1,
    queryFn: () => getDashboardCollection<StageMetric[]>("tickets-by-stage", dashboardFilters),
  });
  const schoolReporterQuery = useQuery({
    queryKey: ["dashboard-school-reporter-metrics", user?.id, dashboardFilters.tenantId, dashboardFilters.schoolId, dashboardFilters.dateFrom, dashboardFilters.dateTo],
    enabled: !!user,
    retry: 1,
    queryFn: () => getDashboardCollection<SchoolReporterMetric[]>("tickets-by-school-and-reporter", dashboardFilters),
  });
  const resolutionBySchoolQuery = useQuery({
    queryKey: ["dashboard-resolution-school-metrics", user?.id, dashboardFilters.tenantId, dashboardFilters.schoolId, dashboardFilters.dateFrom, dashboardFilters.dateTo],
    enabled: !!user,
    retry: 1,
    queryFn: () => getDashboardCollection<ResolutionMetric[]>("resolution-by-school", dashboardFilters),
  });

  const { data: openTicketsData, refetch: refetchOpenTickets } = useListTickets(
    { tenantId, limit: 100 },
    { query: { enabled: user?.role === "superadmin" && openTicketsDialog } },
  );
  const { data: techniciansData } = useListUsers(
    { role: "tecnico", active: true, limit: 100 },
    { query: { enabled: user?.role === "superadmin" && openTicketsDialog } },
  );

  const assignTicket = useAssignTicket({
    mutation: {
      onSuccess: async () => {
        toast({
          title: "Ticket asignado",
          description: "La asignacion se ha guardado correctamente.",
        });
        await refetchOpenTickets();
      },
      onError: (error) => {
        toast({
          title: "No se pudo asignar el ticket",
          description: error instanceof Error ? error.message : "Intentalo de nuevo.",
          variant: "destructive",
        });
      },
    },
  });

  const openTickets = useMemo(
    () => (openTicketsData?.data ?? []).filter((ticket) => openStatuses.includes(ticket.status)),
    [openTicketsData?.data],
  );
  const technicians = techniciansData?.data ?? [];
  const schoolData = schoolDataQuery.data ?? [];
  const inquiryTypeData = inquiryTypeQuery.data ?? [];
  const stageData = stageQuery.data ?? [];
  const schoolReporterData = schoolReporterQuery.data ?? [];
  const resolutionBySchoolData = resolutionBySchoolQuery.data ?? [];

  const resolvedVsPending = useMemo(() => {
    const resolved = Number(stats?.resolvedTickets ?? 0) + Number(stats?.closedTickets ?? 0);
    const pending = Number(stats?.openTickets ?? 0);
    return [
      { name: "Resueltas", value: resolved, color: "#14b8a6" },
      { name: "Pendientes", value: pending, color: "#f97316" },
    ];
  }, [stats?.closedTickets, stats?.openTickets, stats?.resolvedTickets]);

  function handleAssignTicket(ticketId: number) {
    const selectedUserId = assignmentDrafts[ticketId];
    if (!selectedUserId) {
      toast({
        title: "Selecciona un tecnico",
        description: "Elige primero el tecnico al que quieres asignar este ticket.",
        variant: "destructive",
      });
      return;
    }

    assignTicket.mutate({
      ticketId,
      data: { userId: Number(selectedUserId) },
    });
  }

  if (statsLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-80 rounded-2xl bg-slate-200" />
        <div className="grid gap-5 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-36 rounded-3xl bg-slate-200" />
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="h-96 rounded-3xl bg-slate-200" />
          <div className="h-96 rounded-3xl bg-slate-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-indigo-50/70 p-8 shadow-sm">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-indigo-600 shadow-sm">
              <BarChart3 className="h-3.5 w-3.5" />
              Estadisticas
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Panel de consultas</h1>
              <p className="mt-2 max-w-2xl text-base text-slate-600">
                Una vista clara de volumen, resolucion, tipologias y carga por colegio para tomar decisiones rapidas.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Consultas abiertas</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{stats?.openTickets ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Tiempo medio</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{formatHours(stats?.avgResolutionHours)}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Urgentes</p>
              <p className="mt-2 text-3xl font-semibold text-rose-600">{stats?.urgentTickets ?? 0}</p>
            </div>
          </div>
        </div>

        {canUseGlobalFilters && (
          <div className="mt-6 grid gap-3 rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm lg:grid-cols-[1.3fr_1fr_1fr]">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Colegio</p>
              <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Todos los colegios" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los colegios</SelectItem>
                  {availableSchools.map((school) => (
                    <SelectItem key={school.id} value={String(school.id)}>
                      {school.name} - {school.tenantName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Desde</p>
              <Input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setDateFrom(nextValue);
                  if (dateTo && nextValue && nextValue > dateTo) {
                    setDateTo(nextValue);
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Hasta</p>
              <Input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  if (dateFrom && nextValue && nextValue < dateFrom) {
                    setDateTo(dateFrom);
                    return;
                  }
                  setDateTo(nextValue);
                }}
              />
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
        <Card className={`rounded-[1.75rem] border-0 bg-slate-950 text-white shadow-xl shadow-slate-950/10 ${user?.role === "superadmin" ? "cursor-pointer transition hover:-translate-y-0.5 hover:shadow-2xl" : ""}`} onClick={user?.role === "superadmin" ? () => setOpenTicketsDialog(true) : undefined}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardDescription className="text-slate-300">Consultas abiertas</CardDescription>
              <Ticket className="h-5 w-5 text-indigo-300" />
            </div>
            <CardTitle className="text-4xl font-semibold">{stats?.openTickets ?? 0}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-slate-300">
            {user?.role === "superadmin" ? "Pulsa para revisar responsables y reasignar tickets." : "Pendientes de resolucion o respuesta."}
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem] border-0 bg-emerald-500 text-white shadow-xl shadow-emerald-500/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardDescription className="text-emerald-50/80">Resueltas</CardDescription>
              <CheckCircle2 className="h-5 w-5 text-emerald-100" />
            </div>
            <CardTitle className="text-4xl font-semibold">{(stats?.resolvedTickets ?? 0) + (stats?.closedTickets ?? 0)}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-emerald-50/85">Incluye consultas resueltas y cerradas.</CardContent>
        </Card>

        <Card className="rounded-[1.75rem] border-0 bg-white shadow-xl shadow-indigo-100/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardDescription>Promedio de resolucion</CardDescription>
              <Clock3 className="h-5 w-5 text-sky-500" />
            </div>
            <CardTitle className="text-4xl font-semibold text-slate-950">{formatHours(stats?.avgResolutionHours)}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-slate-500">Tiempo medio invertido desde la creacion hasta la resolucion.</CardContent>
        </Card>

        <Card className="rounded-[1.75rem] border-0 bg-white shadow-xl shadow-indigo-100/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardDescription>{canUseGlobalFilters ? "Colegios activos" : "Tickets nuevos"}</CardDescription>
              {canUseGlobalFilters ? <Building2 className="h-5 w-5 text-violet-500" /> : <AlertCircle className="h-5 w-5 text-orange-500" />}
            </div>
            <CardTitle className="text-4xl font-semibold text-slate-950">{canUseGlobalFilters ? (stats as any)?.totalSchools ?? 0 : stats?.newTickets ?? 0}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-slate-500">
            {canUseGlobalFilters ? "Colegios con actividad dentro del filtro actual." : "Consultas nuevas pendientes de primera atencion."}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.4fr_0.9fr]">
        <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/50">
          <CardHeader>
            <CardTitle>Volumen temporal de consultas</CardTitle>
            <CardDescription>Creadas y resueltas a lo largo del tiempo.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[340px] w-full">
              {timeData.length === 0 ? (
                <ChartEmpty message="Todavia no hay datos temporales suficientes." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeData} margin={{ top: 12, right: 16, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="createdGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.32} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="resolvedGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(value) => format(new Date(value), "d MMM", { locale: es })} />
                    <YAxis tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <RechartsTooltip contentStyle={{ borderRadius: "16px", border: "1px solid #e2e8f0", boxShadow: "0 12px 32px rgba(15,23,42,0.08)" }} labelFormatter={(value) => format(new Date(value), "d 'de' MMMM", { locale: es })} />
                    <Legend />
                    <Area type="monotone" dataKey="created" name="Creadas" stroke="#4f46e5" fill="url(#createdGradient)" strokeWidth={3} />
                    <Area type="monotone" dataKey="resolved" name="Resueltas" stroke="#14b8a6" fill="url(#resolvedGradient)" strokeWidth={3} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/50">
          <CardHeader>
            <CardTitle>Resueltas vs pendientes</CardTitle>
            <CardDescription>Foto rapida del estado operativo actual.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[340px] w-full">
              {resolvedVsPending.every((item) => item.value === 0) ? (
                <ChartEmpty message="Sin datos de estado para representar." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={resolvedVsPending} dataKey="value" nameKey="name" innerRadius={78} outerRadius={118} paddingAngle={3}>
                      {resolvedVsPending.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                    </Pie>
                    <RechartsTooltip contentStyle={{ borderRadius: "16px", border: "1px solid #e2e8f0" }} />
                    <Legend verticalAlign="bottom" />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <School2 className="h-5 w-5 text-indigo-500" />
              <CardTitle>Consultas por colegio</CardTitle>
            </div>
            <CardDescription>Los centros con mayor volumen de consultas.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[360px] w-full">
              {schoolDataQuery.isError ? (
                <ChartEmpty message="No se pudieron cargar las consultas por colegio." />
              ) : schoolData.length === 0 ? (
                <ChartEmpty message="No hay datos por colegio para este filtro." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={schoolData} layout="vertical" margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2ff" />
                    <XAxis type="number" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="schoolName" type="category" width={150} tick={{ fontSize: 12, fill: "#475569" }} axisLine={false} tickLine={false} tickFormatter={(value) => truncateLabel(String(value), 18)} />
                    <RechartsTooltip contentStyle={{ borderRadius: "16px", border: "1px solid #e2e8f0" }} />
                    <Bar dataKey="count" radius={[0, 12, 12, 0]} fill="#4f46e5" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers3 className="h-5 w-5 text-fuchsia-500" />
              <CardTitle>Distribucion por tipo de consulta</CardTitle>
            </div>
            <CardDescription>Que motivos concentran mas actividad.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[360px] w-full">
              {inquiryTypeQuery.isError ? (
                <ChartEmpty message="No se pudo cargar la distribucion por tipo." />
              ) : inquiryTypeData.length === 0 ? (
                <ChartEmpty message="No hay tipos de consulta suficientes para mostrar." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={inquiryTypeData} dataKey="count" nameKey="inquiryType" innerRadius={70} outerRadius={118} paddingAngle={3}>
                      {inquiryTypeData.map((entry, index) => <Cell key={entry.inquiryType} fill={palette[index % palette.length]} />)}
                    </Pie>
                    <RechartsTooltip contentStyle={{ borderRadius: "16px", border: "1px solid #e2e8f0" }} />
                    <Legend verticalAlign="bottom" formatter={(value) => truncateLabel(String(value), 18)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <BadgeCheck className="h-5 w-5 text-emerald-500" />
              <CardTitle>Consultas por etapa educativa</CardTitle>
            </div>
            <CardDescription>Distribucion por etapa indicada en la consulta.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[340px] w-full">
              {stageQuery.isError ? (
                <ChartEmpty message="No se pudo cargar la etapa educativa." />
              ) : stageData.length === 0 ? (
                <ChartEmpty message="No hay etapas registradas para mostrar." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stageData} margin={{ top: 8, right: 12, left: -12, bottom: 22 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="stage" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(value) => truncateLabel(String(value), 12)} />
                    <YAxis tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <RechartsTooltip contentStyle={{ borderRadius: "16px", border: "1px solid #e2e8f0" }} />
                    <Bar dataKey="count" fill="#14b8a6" radius={[12, 12, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users2 className="h-5 w-5 text-orange-500" />
              <CardTitle>Consultas por colegio e informador</CardTitle>
            </div>
            <CardDescription>Relacion entre centros y personas que mas registran consultas.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[340px] w-full">
              {schoolReporterQuery.isError ? (
                <ChartEmpty message="No se pudo cargar la relacion por colegio e informador." />
              ) : schoolReporterData.length === 0 ? (
                <ChartEmpty message="No hay suficientes datos de informadores." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={schoolReporterData} layout="vertical" margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#fff7ed" />
                    <XAxis type="number" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="label" width={190} tick={{ fontSize: 12, fill: "#475569" }} axisLine={false} tickLine={false} tickFormatter={(value) => truncateLabel(String(value), 26)} />
                    <RechartsTooltip contentStyle={{ borderRadius: "16px", border: "1px solid #e2e8f0" }} />
                    <Bar dataKey="count" fill="#f97316" radius={[0, 12, 12, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-sky-500" />
              <CardTitle>Tiempo medio de resolucion por colegio</CardTitle>
            </div>
            <CardDescription>Promedio de horas por centro con tickets resueltos.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[320px] w-full">
              {resolutionBySchoolQuery.isError ? (
                <ChartEmpty message="No se pudo cargar el tiempo medio de resolucion." />
              ) : resolutionBySchoolData.length === 0 ? (
                <ChartEmpty message="Todavia no hay resoluciones suficientes para comparar colegios." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={resolutionBySchoolData} layout="vertical" margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2ff" />
                    <XAxis type="number" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="schoolName" width={150} tick={{ fontSize: 12, fill: "#475569" }} axisLine={false} tickLine={false} tickFormatter={(value) => truncateLabel(String(value), 18)} />
                    <RechartsTooltip contentStyle={{ borderRadius: "16px", border: "1px solid #e2e8f0" }} formatter={(value: number, _name, item) => [`${Number(value).toFixed(1)} h`, item.payload.schoolName]} />
                    <Bar dataKey="avgHours" fill="#0ea5e9" radius={[0, 12, 12, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserRoundSearch className="h-5 w-5 text-violet-500" />
              <CardTitle>Actividad reciente</CardTitle>
            </div>
            <CardDescription>Las ultimas acciones registradas en el sistema.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {activity.length === 0 ? (
              <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-slate-500">Sin actividad reciente.</div>
            ) : (
              activity.map((item) => (
                <div key={item.id} className="flex gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="mt-1 h-2.5 w-2.5 rounded-full bg-indigo-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {item.userName} <span className="font-normal text-slate-600">{item.action} {item.entityType}</span>
                    </p>
                    {item.entityTitle && <p className="mt-1 line-clamp-1 text-sm text-slate-500">{item.entityTitle}</p>}
                    <p className="mt-2 text-xs text-slate-400">
                      {format(new Date(item.createdAt), "d MMM, HH:mm", { locale: es })}
                      {item.tenantName ? ` - ${item.tenantName}` : ""}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <Dialog open={openTicketsDialog} onOpenChange={setOpenTicketsDialog}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Tickets abiertos</DialogTitle>
            <DialogDescription>Revisa responsables y reasigna tickets rapidamente.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {openTickets.length === 0 ? (
              <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">No hay tickets abiertos ahora mismo.</div>
            ) : (
              openTickets.map((ticket) => (
                <div key={ticket.id} className="grid gap-3 rounded-xl border p-4 lg:grid-cols-[1.4fr_0.9fr_0.9fr_auto] lg:items-center">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">{ticket.title}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>#{ticket.ticketNumber}</span>
                      <span>-</span>
                      <span>{ticket.schoolName || ticket.tenantName}</span>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Estado</p>
                    <div className="mt-1">
                      <StatusBadge status={ticket.status} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Asignado a</p>
                    <Select value={assignmentDrafts[ticket.id] ?? (ticket.assignedToId ? String(ticket.assignedToId) : "unassigned")} onValueChange={(value) => setAssignmentDrafts((current) => ({ ...current, [ticket.id]: value }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Sin asignar" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Sin asignar</SelectItem>
                        {technicians.map((tech) => (
                          <SelectItem key={tech.id} value={String(tech.id)}>
                            {tech.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex justify-end">
                    <Button type="button" onClick={() => handleAssignTicket(ticket.id)} disabled={assignTicket.isPending || (assignmentDrafts[ticket.id] ?? (ticket.assignedToId ? String(ticket.assignedToId) : "unassigned")) === "unassigned"}>
                      Asignar
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
