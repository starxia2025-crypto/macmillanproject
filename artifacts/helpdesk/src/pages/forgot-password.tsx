import { useState } from "react";
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

const forgotPasswordSchema = z.object({
  email: z.string().email("Introduce un correo valido"),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPassword() {
  const [isSending, setIsSending] = useState(false);
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordValues) {
    setIsSending(true);
    try {
      await customFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: values.email.trim().toLowerCase() }),
      });

      toast({
        title: "Solicitud recibida",
        description: "Si el correo existe, se enviaran instrucciones para restablecer la contrasena.",
      });
    } catch {
      toast({
        title: "Solicitud recibida",
        description: "Si el correo existe, se enviaran instrucciones para restablecer la contrasena.",
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <h1 className="text-2xl font-bold text-slate-900">Recuperar contrasena</h1>
          <p className="text-sm text-slate-500">Indica tu correo y te enviaremos instrucciones si existe una cuenta activa.</p>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Correo electronico</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="nombre@centro.es" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" disabled={isSending}>
                {isSending ? "Enviando..." : "Enviar instrucciones"}
              </Button>
              <Link href="/">
                <span className="block cursor-pointer text-center text-sm font-medium text-primary hover:underline">
                  Volver al inicio de sesion
                </span>
              </Link>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
