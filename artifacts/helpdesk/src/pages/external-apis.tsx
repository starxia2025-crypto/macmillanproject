import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Copy, Download, KeyRound, Loader2, RefreshCcw, ShieldCheck, ToggleLeft, ToggleRight } from "lucide-react";

type ApiClientItem = {
  schoolId: number;
  schoolName: string;
  tenantId: number;
  tenantName: string;
  active: boolean;
  clientId: string | null;
  createdAt: string | null;
  lastCallAt: string | null;
  totalCalls: number;
  createdTickets: number;
  apiKeyLastFour: string | null;
};

type ApiLogItem = {
  id: number;
  clientId: string;
  externalId: string | null;
  eventType: string;
  statusCode: number;
  success: number;
  errorMessage: string | null;
  sourceIp: string | null;
  createdTicketId: number | null;
  createdAt: string;
};

type ApiDocumentation = {
  endpoint: string;
  method: string;
  authHeaders: string[];
  supportedTypes: string[];
  notes: string[];
};

export default function ExternalApisPage() {
  const queryClient = useQueryClient();
  const [selectedClient, setSelectedClient] = useState<ApiClientItem | null>(null);
  const [provisioning, setProvisioning] = useState<{ clientId: string; apiKey: string } | null>(null);

  const clientsQuery = useQuery({
    queryKey: ["external-api-clients"],
    queryFn: () => customFetch<{ data: ApiClientItem[] }>("/api/integrations/clients", { method: "GET" }),
  });

  const logsQuery = useQuery({
    queryKey: ["external-api-logs", selectedClient?.clientId],
    queryFn: () => customFetch<{ data: ApiLogItem[] }>(`/api/integrations/logs?clientId=${encodeURIComponent(selectedClient?.clientId || "")}`, { method: "GET" }),
    enabled: !!selectedClient?.clientId,
  });

  const docsQuery = useQuery({
    queryKey: ["external-api-documentation"],
    queryFn: () => customFetch<ApiDocumentation>("/api/integrations/documentation", { method: "GET" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ schoolId, active }: { schoolId: number; active: boolean }) =>
      customFetch<{ provisioning: { clientId: string; apiKey: string } | null }>(`/api/integrations/clients/${schoolId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      }),
    onSuccess: async (result) => {
      if (result.provisioning) {
        setProvisioning(result.provisioning);
      }
      toast({ title: "Integracion actualizada", description: "El estado de la API externa se ha guardado correctamente." });
      await queryClient.invalidateQueries({ queryKey: ["external-api-clients"] });
    },
    onError: (error) => {
      toast({
        title: "No se pudo actualizar la integracion",
        description: error instanceof Error ? error.message : "Intentalo de nuevo.",
        variant: "destructive",
      });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async ({ tenantId, schoolId }: { tenantId: number; schoolId: number }) =>
      customFetch<{ clientId: string; apiKey: string }>(`/api/tenants/${tenantId}/schools/${schoolId}/external-api/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    onSuccess: async (result) => {
      setProvisioning({ clientId: result.clientId, apiKey: result.apiKey });
      toast({ title: "API key regenerada", description: "Se ha generado una nueva clave de acceso." });
      await queryClient.invalidateQueries({ queryKey: ["external-api-clients"] });
    },
    onError: (error) => {
      toast({
        title: "No se pudo regenerar la API key",
        description: error instanceof Error ? error.message : "Intentalo de nuevo.",
        variant: "destructive",
      });
    },
  });

  const clients = clientsQuery.data?.data ?? [];
  const logs = logsQuery.data?.data ?? [];
  const totalActive = useMemo(() => clients.filter((client) => client.active).length, [clients]);

  function copyProvisioning(value: string) {
    void navigator.clipboard.writeText(value);
    toast({ title: "Copiado", description: "El valor se ha copiado al portapapeles." });
  }

  function exportLogs(clientId?: string | null) {
    const suffix = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
    window.open(`/api/integrations/logs/export${suffix}`, "_blank");
  }

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-cyan-50/60 p-8 shadow-sm">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              APIs externas
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Integraciones y trazabilidad</h1>
              <p className="mt-2 max-w-3xl text-base text-slate-600">
                Gestiona clientes con API activa, controla sus llamadas, rota claves sin exponer secretos y deja una
                base clara para auditoria y soporte.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Clientes API</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{clients.length}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Activas</p>
              <p className="mt-2 text-3xl font-semibold text-emerald-600">{totalActive}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Llamadas registradas</p>
              <p className="mt-2 text-3xl font-semibold text-cyan-700">{clients.reduce((sum, item) => sum + item.totalCalls, 0)}</p>
            </div>
          </div>
        </div>
      </section>

      <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/40">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Clientes con integracion</CardTitle>
            <CardDescription>Se muestra solo el identificador del cliente y los ultimos 4 caracteres de la clave si el sistema los conoce.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => exportLogs()}>
              <Download className="h-4 w-4" />
              Exportar logs
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => clientsQuery.refetch()}>
              <RefreshCcw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {clientsQuery.isLoading ? (
            <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-slate-500">Cargando integraciones...</div>
          ) : clients.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-slate-500">Todavia no hay clientes con API configurada.</div>
          ) : (
            clients.map((client) => (
              <div key={client.schoolId} className="grid gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm xl:grid-cols-[1.2fr_0.9fr_0.8fr_0.8fr_auto]">
                <div>
                  <p className="font-semibold text-slate-900">{client.schoolName}</p>
                  <p className="mt-1 text-sm text-slate-500">{client.tenantName}</p>
                  <p className="mt-2 text-xs text-slate-500">Client ID: <span className="font-medium text-slate-700">{client.clientId}</span></p>
                </div>
                <div className="text-sm text-slate-600">
                  <p>Estado: <span className="font-medium text-slate-800">{client.active ? "Activa" : "Desactivada"}</span></p>
                  <p className="mt-1">API key: {client.apiKeyLastFour ? `****${client.apiKeyLastFour}` : "Configurada"}</p>
                  <p className="mt-1">Creada: {client.createdAt ? format(new Date(client.createdAt), "d MMM yyyy", { locale: es }) : "-"}</p>
                </div>
                <div className="text-sm text-slate-600">
                  <p>Llamadas: <span className="font-medium text-slate-800">{client.totalCalls}</span></p>
                  <p className="mt-1">Tickets API: <span className="font-medium text-slate-800">{client.createdTickets}</span></p>
                  <p className="mt-1">Ultima llamada: {client.lastCallAt ? format(new Date(client.lastCallAt), "d MMM, HH:mm", { locale: es }) : "-"}</p>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <Badge variant="outline" className={client.active ? "border-transparent bg-emerald-100 text-emerald-700" : "border-transparent bg-slate-100 text-slate-700"}>
                    {client.active ? "Activa" : "Desactivada"}
                  </Badge>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setSelectedClient(client)}>Ver logs</Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => toggleMutation.mutate({ schoolId: client.schoolId, active: !client.active })}
                    disabled={toggleMutation.isPending}
                  >
                    {client.active ? <ToggleLeft className="h-4 w-4" /> : <ToggleRight className="h-4 w-4" />}
                    {client.active ? "Desactivar" : "Activar"}
                  </Button>
                  <Button
                    className="gap-2"
                    onClick={() => regenerateMutation.mutate({ tenantId: client.tenantId, schoolId: client.schoolId })}
                    disabled={regenerateMutation.isPending}
                  >
                    {regenerateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    Regenerar API key
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="rounded-[1.75rem] border-slate-200/80 shadow-lg shadow-slate-200/40">
        <CardHeader>
          <CardTitle>Documentacion basica del endpoint</CardTitle>
          <CardDescription>Resumen rapido para soporte y entrega controlada al cliente final.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-600">
          <p><span className="font-semibold text-slate-900">Endpoint:</span> {docsQuery.data?.endpoint ?? "/api/integrations/external"}</p>
          <p><span className="font-semibold text-slate-900">Metodo:</span> {docsQuery.data?.method ?? "POST"}</p>
          <p><span className="font-semibold text-slate-900">Cabeceras:</span> {(docsQuery.data?.authHeaders ?? []).join(", ")}</p>
          <p><span className="font-semibold text-slate-900">Tipos soportados:</span> {(docsQuery.data?.supportedTypes ?? []).join(", ")}</p>
          <ul className="list-disc space-y-1 pl-5">
            {(docsQuery.data?.notes ?? []).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={!!selectedClient} onOpenChange={(open) => !open && setSelectedClient(null)}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Logs de integracion</DialogTitle>
            <DialogDescription>{selectedClient?.schoolName} · {selectedClient?.clientId}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => exportLogs(selectedClient?.clientId)}>
              <Download className="mr-2 h-4 w-4" />
              Exportar logs de este cliente
            </Button>
          </div>
          <div className="space-y-3">
            {logsQuery.isLoading ? (
              <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">Cargando logs...</div>
            ) : logs.length === 0 ? (
              <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">Todavia no hay llamadas registradas para este cliente.</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">{log.eventType}</p>
                      <p className="mt-1 text-sm text-slate-500">{format(new Date(log.createdAt), "d MMM yyyy, HH:mm", { locale: es })}</p>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="outline" className={log.success ? "border-transparent bg-emerald-100 text-emerald-700" : "border-transparent bg-rose-100 text-rose-700"}>
                        {log.success ? "OK" : "Error"}
                      </Badge>
                      <Badge variant="outline">{log.statusCode}</Badge>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                    <p>External ID: <span className="font-medium text-slate-800">{log.externalId || "-"}</span></p>
                    <p>Ticket creado: <span className="font-medium text-slate-800">{log.createdTicketId || "-"}</span></p>
                    <p>IP origen: <span className="font-medium text-slate-800">{log.sourceIp || "-"}</span></p>
                    <p>Error: <span className="font-medium text-slate-800">{log.errorMessage || "-"}</span></p>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter />
        </DialogContent>
      </Dialog>

      <Dialog open={!!provisioning} onOpenChange={(open) => !open && setProvisioning(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>API key generada</DialogTitle>
            <DialogDescription>Este es el unico momento en el que la clave completa se muestra en pantalla.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 rounded-2xl border border-sky-200 bg-sky-50/80 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">x-client-id</p>
              <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2">
                <code className="text-sm text-slate-800">{provisioning?.clientId}</code>
                <Button size="sm" variant="outline" onClick={() => provisioning && copyProvisioning(provisioning.clientId)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar
                </Button>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">x-api-key</p>
              <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2">
                <code className="text-sm text-slate-800">{provisioning?.apiKey}</code>
                <Button size="sm" variant="outline" onClick={() => provisioning && copyProvisioning(provisioning.apiKey)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter />
        </DialogContent>
      </Dialog>
    </div>
  );
}
