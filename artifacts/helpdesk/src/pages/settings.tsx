import { useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { RoleBadge } from "@/components/badges";

export default function Settings() {
  const { data: user, isLoading } = useGetMe();

  if (isLoading) {
    return <div className="animate-pulse h-96 bg-slate-100 rounded-xl" />;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Configuración</h1>
        <p className="text-slate-500 mt-1">Gestiona las preferencias de tu cuenta.</p>
      </div>

      <div className="grid md:grid-cols-4 gap-8 items-start">
        <div className="flex flex-col gap-1">
          <Button variant="secondary" className="justify-start">Perfil</Button>
          <Button variant="ghost" className="justify-start">Notificaciones</Button>
          <Button variant="ghost" className="justify-start">Seguridad</Button>
        </div>

        <div className="md:col-span-3 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Información de Perfil</CardTitle>
              <CardDescription>Tu información personal y detalles de rol.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6">
                <div className="h-20 w-20 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl font-bold border-2 border-primary/20">
                  {user?.name?.charAt(0)}
                </div>
                <div>
                  <h3 className="font-medium text-lg">{user?.name}</h3>
                  <p className="text-slate-500 text-sm mb-2">{user?.email}</p>
                  <RoleBadge role={user?.role || ''} />
                </div>
              </div>

              <Separator />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nombre completo</Label>
                  <Input defaultValue={user?.name} />
                </div>
                <div className="space-y-2">
                  <Label>Correo electrónico</Label>
                  <Input defaultValue={user?.email} disabled className="bg-slate-50" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Organización / Cliente</Label>
                  <Input defaultValue={user?.tenantName || 'Soporte Macmillan Sistema'} disabled className="bg-slate-50" />
                </div>
              </div>
            </CardContent>
            <CardFooter className="border-t bg-slate-50 dark:bg-slate-900/50 px-6 py-4">
              <Button>Guardar cambios</Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Apariencia</CardTitle>
              <CardDescription>Personaliza cómo se ve Soporte Macmillan en tu dispositivo.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="border-2 border-primary rounded-xl p-4 cursor-pointer">
                  <div className="h-24 bg-slate-100 rounded-md mb-2 w-full flex flex-col gap-2 p-2">
                    <div className="h-4 bg-white rounded shadow-sm w-full" />
                    <div className="h-10 bg-white rounded shadow-sm w-full" />
                  </div>
                  <div className="text-sm font-medium text-center text-primary">Claro</div>
                </div>
                <div className="border border-slate-200 hover:border-primary/50 transition-colors rounded-xl p-4 cursor-pointer">
                  <div className="h-24 bg-slate-900 rounded-md mb-2 w-full flex flex-col gap-2 p-2">
                    <div className="h-4 bg-slate-800 rounded border border-slate-700 w-full" />
                    <div className="h-10 bg-slate-800 rounded border border-slate-700 w-full" />
                  </div>
                  <div className="text-sm font-medium text-center text-slate-500">Oscuro</div>
                </div>
                <div className="border border-slate-200 hover:border-primary/50 transition-colors rounded-xl p-4 cursor-pointer">
                  <div className="h-24 bg-gradient-to-r from-slate-100 to-slate-900 rounded-md mb-2 w-full flex flex-col gap-2 p-2" />
                  <div className="text-sm font-medium text-center text-slate-500">Sistema</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
