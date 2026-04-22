import { Link, useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { getDefaultRouteForRole } from "@/lib/default-route";
import meeLogo from "@/assets/mee-logo.svg";

const loginSchema = z.object({
  email: z.string().email("Introduce un correo electrónico válido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  captchaAnswer: z.string().optional(),
});

const LOGIN_BUTTON_COLOR = "#2563eb";
const RECENT_LOGIN_EMAILS_STORAGE_KEY = "helpdesk-recent-login-emails";
const MAX_RECENT_LOGIN_EMAILS = 5;

type LoginFormValues = z.infer<typeof loginSchema>;
type CaptchaChallenge = {
  question: string;
  token: string;
};

function readRecentLoginEmails() {
  try {
    const rawValue = window.localStorage.getItem(RECENT_LOGIN_EMAILS_STORAGE_KEY);
    const parsedValue = rawValue ? JSON.parse(rawValue) : [];
    return Array.isArray(parsedValue)
      ? parsedValue.filter((value): value is string => typeof value === "string" && value.includes("@"))
      : [];
  } catch {
    return [];
  }
}

function writeRecentLoginEmails(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return readRecentLoginEmails();

  const nextEmails = [
    normalizedEmail,
    ...readRecentLoginEmails().filter((recentEmail) => recentEmail.toLowerCase() !== normalizedEmail),
  ].slice(0, MAX_RECENT_LOGIN_EMAILS);

  window.localStorage.setItem(RECENT_LOGIN_EMAILS_STORAGE_KEY, JSON.stringify(nextEmails));
  return nextEmails;
}

export default function MacmillanLogin() {
  const [, setLocation] = useLocation();
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const [recentLoginEmails, setRecentLoginEmails] = useState<string[]>([]);
  const [captchaChallenge, setCaptchaChallenge] = useState<CaptchaChallenge | null>(null);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", captchaAnswer: "" },
  });

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (response) => {
        setCaptchaChallenge(null);
        form.setValue("captchaAnswer", "");
        setRecentLoginEmails(writeRecentLoginEmails(form.getValues("email")));
        setLocation(response.mustChangePassword ? "/change-password" : getDefaultRouteForRole(response.role));
      },
      onError: (error) => {
        const data = (error as any)?.data;
        if (data?.captchaRequired && data?.captcha?.question && data?.captcha?.token) {
          setCaptchaChallenge(data.captcha);
          form.setValue("captchaAnswer", "");
        }
      },
    },
  });

  useEffect(() => {
    const emails = readRecentLoginEmails();
    setRecentLoginEmails(emails);
    if (emails[0] && !form.getValues("email")) {
      form.setValue("email", emails[0], { shouldValidate: false });
    }
  }, [form]);

  function onSubmit(data: LoginFormValues) {
    if (captchaChallenge && !data.captchaAnswer?.trim()) {
      form.setError("captchaAnswer", { message: "Resuelve el captcha para continuar" });
      return;
    }

    loginMutation.mutate({
      data: {
        email: data.email,
        password: data.password,
        captchaAnswer: data.captchaAnswer,
        captchaToken: captchaChallenge?.token,
      },
    });
  }

  function selectRecentLoginEmail(email: string) {
    form.setValue("email", email, { shouldDirty: true, shouldValidate: true });
    passwordInputRef.current?.focus();
  }

  function clearRecentLoginEmails() {
    window.localStorage.removeItem(RECENT_LOGIN_EMAILS_STORAGE_KEY);
    setRecentLoginEmails([]);
  }

  function getLoginErrorMessage() {
    const rawMessage = loginMutation.error?.message || "";

    if (
      rawMessage.includes("401") ||
      rawMessage.includes("429") ||
      rawMessage.toLowerCase().includes("credenciales")
    ) {
      return "Credenciales no válidas";
    }

    if (rawMessage.toLowerCase().includes("failed to fetch")) {
      return "No se pudo conectar con el servidor. Inténtalo de nuevo en unos segundos.";
    }

    return "No se pudo iniciar sesión. Revisa tus datos e inténtalo de nuevo.";
  }

  return (
    <div className="flex min-h-screen w-full bg-slate-50 dark:bg-slate-950">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex">
        <div className="absolute inset-0 z-0 opacity-10">
          <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        <div className="relative z-10 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/96 shadow-[0_18px_45px_-24px_rgba(15,23,42,0.55)] ring-1 ring-white/60">
            <img src={meeLogo} alt="Macmillan Education Everywhere" className="h-10 w-auto object-contain" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary-foreground/55">Macmillan Education</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">Soporte Macmillan</p>
          </div>
        </div>

        <div className="relative z-10">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6 text-5xl font-bold leading-tight"
          >
            Soporte educativo, claro y cercano.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="max-w-md text-lg text-primary-foreground/80"
          >
            Unifica incidencias, conocimiento y seguimiento para directores, jefes de estudio y profesorado en un entorno moderno y sencillo.
          </motion.p>
        </div>

        <div className="relative z-10 text-sm text-primary-foreground/60">
          © {new Date().getFullYear()} Macmillan Iberia. Todos los derechos reservados.
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center p-8">
        <div className="absolute right-8 top-8 hidden items-center gap-4 rounded-2xl border border-slate-200/70 bg-white/92 px-5 py-4 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.38)] backdrop-blur lg:flex">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 ring-1 ring-slate-200">
            <img src={meeLogo} alt="Macmillan Education Everywhere" className="h-10 w-auto object-contain" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Macmillan Education</p>
            <p className="mt-1 text-xl font-bold tracking-tight text-slate-900">Soporte Macmillan</p>
          </div>
        </div>

        <div className="w-full max-w-md space-y-8">
          <div className="text-center lg:text-left">
            <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white ring-1 ring-slate-200 shadow-sm">
                <img src={meeLogo} alt="Macmillan Education Everywhere" className="h-7 w-auto object-contain" />
              </div>
              <span className="text-xl font-bold text-slate-900 dark:text-white">Soporte Macmillan</span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Bienvenido</h2>
            <p className="mt-2 text-slate-500">Inicia sesión para continuar</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {loginMutation.isError && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm font-medium text-destructive">
                  {getLoginErrorMessage()}
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
                      {recentLoginEmails.length > 0 && (
                        <div className="pt-2">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                              Usuarios recientes
                            </p>
                            <button
                              type="button"
                              onClick={clearRecentLoginEmails}
                              className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-700"
                            >
                              Limpiar
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {recentLoginEmails.map((email) => (
                              <button
                                key={email}
                                type="button"
                                onClick={() => selectRecentLoginEmail(email)}
                                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
                              >
                                {email}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
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
                        <Link href="/forgot-password">
                          <span className="cursor-pointer text-sm font-medium text-primary hover:underline">¿Olvidaste tu contraseña?</span>
                        </Link>
                      </div>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          {...field}
                          ref={(element) => {
                            field.ref(element);
                            passwordInputRef.current = element;
                          }}
                          className="h-11"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {captchaChallenge && (
                  <FormField
                    control={form.control}
                    name="captchaAnswer"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Verificación de seguridad</FormLabel>
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                          <p className="mb-2 text-sm font-medium text-amber-900">
                            Resuelve para continuar: <span className="font-bold">{captchaChallenge.question}</span>
                          </p>
                          <FormControl>
                            <Input inputMode="numeric" placeholder="Resultado" {...field} className="h-11 bg-white" />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <Button
                type="submit"
                className="h-11 w-full text-base font-medium text-white hover:opacity-90"
                style={{ backgroundColor: LOGIN_BUTTON_COLOR }}
                disabled={loginMutation.isPending}
              >
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

