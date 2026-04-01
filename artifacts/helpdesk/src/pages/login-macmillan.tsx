import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLogin, useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { LifeBuoy, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { buildApiUrl } from "@/lib/api-base-url";

const loginSchema = z.object({
  email: z.string().email("Introduce un correo electrónico válido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const MicrosoftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" className="h-4 w-4">
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>
);

export default function MacmillanLogin() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: isUserLoading } = useGetMe();

  useEffect(() => {
    if (user && !isUserLoading) setLocation("/dashboard");
  }, [user, isUserLoading, setLocation]);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const loginMutation = useLogin({
    mutation: {
      onSuccess: () => setLocation("/dashboard"),
    },
  });

  function onSubmit(data: LoginFormValues) {
    loginMutation.mutate({ data });
  }

  function handleMicrosoftLogin() {
    window.location.href = buildApiUrl("/api/auth/microsoft");
  }

  if (isUserLoading || user) return null;

  return (
    <div className="min-h-screen w-full flex bg-slate-50 dark:bg-slate-950">
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-primary p-12 text-primary-foreground relative overflow-hidden">
        <div className="absolute inset-0 z-0 opacity-10">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        <div className="relative z-10 flex items-center gap-3">
          <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center">
            <LifeBuoy className="h-6 w-6 text-primary" />
          </div>
          <span className="font-bold text-2xl tracking-tight">Soporte Macmillan</span>
        </div>

        <div className="relative z-10">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-5xl font-bold leading-tight mb-6"
          >
            Soporte educativo, claro y cercano.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-primary-foreground/80 text-lg max-w-md"
          >
            Unifica incidencias, conocimiento y seguimiento para directores, jefes de estudio y profesorado en un entorno moderno y sencillo.
          </motion.p>
        </div>

        <div className="relative z-10 text-sm text-primary-foreground/60">
          © {new Date().getFullYear()} Macmillan Iberia. Todos los derechos reservados.
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center lg:text-left">
            <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
              <div className="h-8 w-8 bg-primary rounded-md flex items-center justify-center">
                <LifeBuoy className="h-5 w-5 text-white" />
              </div>
              <span className="font-bold text-xl text-slate-900 dark:text-white">Soporte Macmillan</span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Bienvenido</h2>
            <p className="text-slate-500 mt-2">Inicia sesión para continuar</p>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full h-11 gap-3 font-medium border-slate-200 hover:bg-slate-50"
            onClick={handleMicrosoftLogin}
          >
            <MicrosoftIcon />
            Continuar con Microsoft
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-50 dark:bg-slate-950 px-3 text-slate-400">o con correo electrónico</span>
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {loginMutation.isError && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
                  {loginMutation.error?.message || "Correo o contraseña incorrectos. Inténtalo de nuevo."}
                </div>
              )}

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Correo electrónico</FormLabel>
                      <FormControl>
                        <Input placeholder="nombre@escuela.edu" {...field} className="h-11" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Contraseña</FormLabel>
                        <a href="#" className="text-sm font-medium text-primary hover:underline">¿Olvidaste tu contraseña?</a>
                      </div>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} className="h-11" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button type="submit" className="w-full h-11 text-base font-medium" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Iniciando sesión...
                  </>
                ) : (
                  "Iniciar sesión"
                )}
              </Button>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
}
