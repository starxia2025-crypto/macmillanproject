import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { getDefaultRouteForRole } from "@/lib/default-route";

const changePasswordSchema = z
  .object({
    password: z.string().min(12, "La contraseña debe tener al menos 12 caracteres"),
    confirmPassword: z.string().min(12, "Confirma la contraseña"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden",
  });

type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export default function ChangePassword() {
  const { data: user } = useGetMe();
  const [isSaving, setIsSaving] = useState(false);
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit(values: ChangePasswordValues) {
    setIsSaving(true);
    try {
      await customFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ password: values.password }),
      });

      toast({
        title: "Contraseña actualizada",
        description: "Ya puedes acceder normalmente.",
      });

      window.location.href = getDefaultRouteForRole(user?.role ?? "usuario_cliente");
    } catch (error) {
      toast({
        title: "No se pudo cambiar la contraseña",
        description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <h1 className="text-2xl font-bold text-slate-900">Cambia tu contraseña</h1>
          <p className="text-sm text-slate-500">
            Por seguridad, debes crear una contraseña nueva antes de entrar a la app.
          </p>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nueva contraseña</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Mínimo 12 caracteres" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirmar contraseña</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Repite la contraseña" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" disabled={isSaving}>
                {isSaving ? "Guardando..." : "Guardar contraseña"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
