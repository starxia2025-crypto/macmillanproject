import { useMemo, useState } from "react";
import { Link } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

const resetPasswordSchema = z
  .object({
    password: z.string().min(12, "La contrasena debe tener al menos 12 caracteres"),
    confirmPassword: z.string().min(12, "Confirma la contrasena"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contrasenas no coinciden",
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export default function ResetPassword() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token") || "", []);
  const [isSaving, setIsSaving] = useState(false);
  const [done, setDone] = useState(false);
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit(values: ResetPasswordValues) {
    setIsSaving(true);
    try {
      await customFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password: values.password }),
      });

      setDone(true);
      toast({
        title: "Contrasena actualizada",
        description: "Ya puedes iniciar sesion con tu nueva contrasena.",
      });
    } catch (error) {
      toast({
        title: "No se pudo restablecer la contrasena",
        description: error instanceof Error ? error.message : "El enlace no es valido o ha caducado.",
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
          <h1 className="text-2xl font-bold text-slate-900">Restablecer contrasena</h1>
          <p className="text-sm text-slate-500">Crea una contrasena nueva para tu cuenta.</p>
        </CardHeader>
        <CardContent>
          {!token || done ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                {done ? "La contrasena se ha actualizado correctamente." : "El enlace no es valido o ha caducado."}
              </p>
              <Link href="/">
                <span className="block cursor-pointer text-center text-sm font-medium text-primary hover:underline">
                  Volver al inicio de sesion
                </span>
              </Link>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nueva contrasena</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Minimo 12 caracteres" {...field} />
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
                      <FormLabel>Confirmar contrasena</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Repite la contrasena" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" disabled={isSaving}>
                  {isSaving ? "Guardando..." : "Guardar contrasena"}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
