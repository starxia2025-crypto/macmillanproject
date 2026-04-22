import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RoleBadge } from "@/components/badges";
import { toast } from "@/hooks/use-toast";

type SystemAlert = {
  id: number;
  title: string;
  message: string;
  type: "info" | "warning" | "urgent";
  active: boolean;
  updatedAt: string;
} | null;

export default function SettingsAdmin() {
  const { data: user, isLoading } = useGetMe();
  const queryClient = useQueryClient();
  const canManageSystemAlert = user?.role === "superadmin" || user?.role === "tecnico";
  const [alertTitle, setAlertTitle] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [alertType, setAlertType] = useState<"info" | "warning" | "urgent">("warning");
  const [alertActive, setAlertActive] = useState(false);

  const { data: systemAlert } = useQuery({
    queryKey: ["system-alert-manage"],
    queryFn: () => customFetch<SystemAlert>("/api/system-alert", { method: "GET" }),
    enabled: !!user,
    retry: 1,
  });

  useEffect(() => {
    if (!systemAlert) return;
    setAlertTitle(systemAlert.title);
    setAlertMessage(systemAlert.message);
    setAlertType(systemAlert.type);
    setAlertActive(systemAlert.active);
  }, [systemAlert]);

  const saveSystemAlert = useMutation({
    mutationFn: () =>
      customFetch<SystemAlert>("/api/system-alert", {
        method: "PUT",
        body: JSON.stringify({
          title: alertTitle.trim(),
          message: alertMessage.trim(),
          type: alertType,
          active: alertActive,
        }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: async () => {
      toast({
        title: "Aviso global guardado",
        description: alertActive ? "El aviso ya está visible para todos los usuarios." : "El aviso ha quedado guardado sin mostrarse.",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-alert-manage"] }),
        queryClient.invalidateQueries({ queryKey: ["active-system-alert"] }),
      ]);
    },
    onError: (error) => {
      toast({
        title: "No se pudo guardar el aviso",
        description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return <div className="animate-pulse h-96 bg-slate-100 rounded-xl" />;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Configuración</h1>
        <p className="text-slate-500 mt-1">Gestiona tu perfil y los avisos globales del sistema.</p>
      </div>

      <div className="grid md:grid-cols-4 gap-8 items-start">
        <div className="flex flex-col gap-1">
          <Button variant="secondary" className="justify-start">Perfil</Button>
          {canManageSystemAlert && <Button variant="ghost" className="justify-start">Aviso global</Button>}
        </div>

        <div className="md:col-span-3 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Información de perfil</CardTitle>
              <CardDescription>Datos básicos de la sesión actual.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6">
                <div className="h-20 w-20 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl font-bold border-2 border-primary/20">
                  {user?.name?.charAt(0)}
                </div>
                <div>
                  <h3 className="font-medium text-lg">{user?.name}</h3>
                  <p className="text-slate-500 text-sm mb-2">{user?.email}</p>
                  <RoleBadge role={user?.role || ""} />
                </div>
              </div>

              <Separator />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nombre completo</Label>
                  <Input value={user?.name ?? ""} disabled className="bg-slate-50" />
                </div>
                <div className="space-y-2">
                  <Label>Correo electrónico</Label>
                  <Input value={user?.email ?? ""} disabled className="bg-slate-50" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Organización / Cliente</Label>
                  <Input value={user?.tenantName || "Soporte Macmillan Sistema"} disabled className="bg-slate-50" />
                </div>
              </div>
            </CardContent>
          </Card>

          {canManageSystemAlert && (
            <Card>
              <CardHeader>
                <CardTitle>Aviso global del sistema</CardTitle>
                <CardDescription>Visible para todos los usuarios al entrar y mientras tengan la sesión abierta.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="system-alert-title">Título</Label>
                  <Input
                    id="system-alert-title"
                    value={alertTitle}
                    onChange={(event) => setAlertTitle(event.target.value)}
                    placeholder="Incidencia general en plataforma"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="system-alert-message">Mensaje</Label>
                  <Textarea
                    id="system-alert-message"
                    value={alertMessage}
                    onChange={(event) => setAlertMessage(event.target.value)}
                    placeholder="Nuestros servidores están sufriendo un problema técnico. Estamos trabajando para solucionarlo lo antes posible."
                    className="min-h-[120px]"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select value={alertType} onValueChange={(value) => setAlertType(value as "info" | "warning" | "urgent")}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona el tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="urgent">Urgente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border px-4 py-3 md:min-w-[220px]">
                    <div>
                      <p className="text-sm font-medium text-slate-900">Activo</p>
                      <p className="text-xs text-slate-500">Mostrar aviso global</p>
                    </div>
                    <Switch checked={alertActive} onCheckedChange={setAlertActive} />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="border-t bg-slate-50 dark:bg-slate-900/50 px-6 py-4">
                <Button
                  onClick={() => saveSystemAlert.mutate()}
                  disabled={saveSystemAlert.isPending || !alertTitle.trim() || !alertMessage.trim()}
                >
                  {saveSystemAlert.isPending ? "Guardando..." : "Guardar aviso"}
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
