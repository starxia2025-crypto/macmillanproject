import { Link, useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { BookOpenText, Eye, GraduationCap, Headphones, Loader2, Lock, Mail, Ticket, UserRoundCheck } from "lucide-react";
import { getDefaultRouteForRole } from "@/lib/default-route";
import meeLogo from "@/assets/mee-logo.svg";

const loginSchema = z.object({
  email: z.string().email("Introduce un correo electronico valido"),
  password: z.string().min(6, "La contrasena debe tener al menos 6 caracteres"),
  captchaAnswer: z.string().optional(),
  rememberMe: z.boolean(),
});

const RECENT_LOGIN_EMAILS_STORAGE_KEY = "helpdesk-recent-login-emails";
const MAX_RECENT_LOGIN_EMAILS = 5;

type LoginFormValues = z.infer<typeof loginSchema>;
type CaptchaChallenge = {
  question: string;
  token: string;
};

const featureItems = [
  {
    icon: Headphones,
    title: "Soporte",
    description: "Atencion rapida\ny eficaz",
  },
  {
    icon: Ticket,
    title: "Gestion de tickets",
    description: "Seguimiento y control\nde incidencias",
  },
  {
    icon: BookOpenText,
    title: "Recursos",
    description: "Acceso a guias,\ndocumentacion y mas",
  },
  {
    icon: UserRoundCheck,
    title: "Visitas tecnicas",
    description: "Planificacion y gestion\nde intervenciones",
  },
  {
    icon: GraduationCap,
    title: "Formacion",
    description: "Capacitacion y\ncontenidos formativos",
  },
];

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

function BridgeWordmark() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-6 lg:gap-8">
        <div className="relative h-[120px] w-[220px] shrink-0 lg:h-[150px] lg:w-[270px]">
          <div className="absolute left-[22px] top-[8px] h-[78px] w-[18px] rounded-full bg-[#0b2b5b] lg:left-[26px] lg:h-[94px] lg:w-[20px]" />
          <div className="absolute left-[88px] top-[8px] h-[78px] w-[18px] rounded-full bg-[#ff4a43] lg:left-[106px] lg:h-[94px] lg:w-[20px]" />
          <div className="absolute left-0 top-[46px] h-[66px] w-[130px] rounded-[999px] border-[12px] border-r-0 border-[#0b2b5b] lg:top-[54px] lg:h-[82px] lg:w-[160px] lg:border-[13px]" />
          <div className="absolute left-[68px] top-[46px] h-[66px] w-[130px] rounded-[999px] border-[12px] border-l-0 border-[#ff6b57] lg:left-[84px] lg:top-[54px] lg:h-[82px] lg:w-[160px] lg:border-[13px]" />
        </div>

        <div>
          <h1 className="text-[78px] font-bold leading-none tracking-tight text-[#0b2b5b] lg:text-[112px]">Bridge</h1>
          <p className="mt-4 text-[30px] font-medium leading-tight text-slate-500 lg:text-[40px]">
            Plataforma de soporte y servicios
          </p>
        </div>
      </div>
    </div>
  );
}

export default function MacmillanLogin() {
  const [, setLocation] = useLocation();
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const [captchaChallenge, setCaptchaChallenge] = useState<CaptchaChallenge | null>(null);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", captchaAnswer: "", rememberMe: true },
  });

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (response) => {
        setCaptchaChallenge(null);
        form.setValue("captchaAnswer", "");

        if (form.getValues("rememberMe")) {
          writeRecentLoginEmails(form.getValues("email"));
        } else {
          window.localStorage.removeItem(RECENT_LOGIN_EMAILS_STORAGE_KEY);
        }

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

  function getLoginErrorMessage() {
    const rawMessage = loginMutation.error?.message || "";

    if (
      rawMessage.includes("401") ||
      rawMessage.includes("429") ||
      rawMessage.toLowerCase().includes("credenciales")
    ) {
      return "Credenciales no validas";
    }

    if (rawMessage.toLowerCase().includes("failed to fetch")) {
      return "No se pudo conectar con el servidor. Intentalo de nuevo en unos segundos.";
    }

    return "No se pudo iniciar sesion. Revisa tus datos e intentalo de nuevo.";
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.98),_rgba(243,246,252,0.92)_42%,_rgba(235,240,247,0.96)_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1720px] flex-col px-5 pt-5 lg:px-8 lg:pt-6">
        <div className="grid flex-1 gap-8 lg:grid-cols-[minmax(0,1fr)_560px] lg:gap-10">
          <section className="flex flex-col justify-between px-3 py-8 lg:px-8 lg:py-10">
            <div>
              <BridgeWordmark />

              <div className="mt-14 max-w-[860px] lg:mt-16">
                <h2 className="text-4xl font-bold leading-[1.1] tracking-tight text-[#0b2b5b] lg:text-[64px]">
                  Conectamos a las personas.
                  <span className="mt-2 block text-[#ff4a43]">Impulsamos soluciones.</span>
                </h2>

                <p className="mt-8 max-w-[760px] text-xl leading-[1.65] text-slate-600 lg:text-[25px]">
                  Bridge es la plataforma central de soporte y servicios de Macmillan Education. Un puente entre
                  clientes, equipos y soluciones para ofrecer una experiencia agil, cercana y eficiente.
                </p>
              </div>
            </div>

            <div className="mt-12 grid gap-6 border-t border-slate-200/90 pt-8 md:grid-cols-3 xl:grid-cols-5">
              {featureItems.map(({ icon: Icon, title, description }) => (
                <div key={title} className="relative px-2 xl:px-4">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-white text-[#0b2b5b] shadow-sm">
                    <Icon className="h-7 w-7" strokeWidth={1.9} />
                  </div>
                  <h3 className="text-[28px] font-semibold leading-tight text-[#0b2b5b] lg:text-[30px]">{title}</h3>
                  <p className="mt-3 whitespace-pre-line text-base leading-8 text-slate-600 lg:text-[20px]">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <aside className="flex items-center justify-center py-4 lg:py-8">
            <div className="w-full rounded-[30px] border border-slate-200/70 bg-white/92 p-8 shadow-[0_25px_80px_-35px_rgba(15,23,42,0.28)] lg:p-12">
              <div className="text-center">
                <h3 className="text-5xl font-bold tracking-tight text-[#0b2b5b] lg:text-[62px]">Bienvenido</h3>
                <p className="mt-4 text-2xl text-slate-500 lg:text-[24px]">Inicia sesion para continuar</p>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="mt-12 space-y-7">
                  {loginMutation.isError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                      {getLoginErrorMessage()}
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-lg font-semibold text-[#0b2b5b] lg:text-[20px]">
                          Correo electronico
                        </FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Mail className="pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" />
                            <Input
                              placeholder="usuario@macmillan.com"
                              {...field}
                              className="h-[66px] rounded-2xl border-slate-200 pl-16 text-xl text-slate-700 placeholder:text-slate-400"
                            />
                          </div>
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
                        <FormLabel className="text-lg font-semibold text-[#0b2b5b] lg:text-[20px]">Contrasena</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Lock className="pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" />
                            <Input
                              type="password"
                              placeholder="••••••••••"
                              {...field}
                              ref={(element) => {
                                field.ref(element);
                                passwordInputRef.current = element;
                              }}
                              className="h-[66px] rounded-2xl border-slate-200 pl-16 pr-16 text-xl text-slate-700 placeholder:text-slate-400"
                            />
                            <Eye className="pointer-events-none absolute right-5 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" />
                          </div>
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
                          <FormLabel className="text-lg font-semibold text-[#0b2b5b] lg:text-[20px]">
                            Verificacion de seguridad
                          </FormLabel>
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                            <p className="mb-3 text-base font-medium text-amber-900">
                              Resuelve para continuar: <span className="font-bold">{captchaChallenge.question}</span>
                            </p>
                            <FormControl>
                              <Input
                                inputMode="numeric"
                                placeholder="Resultado"
                                {...field}
                                className="h-14 rounded-xl border-amber-200 bg-white text-lg"
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <div className="flex flex-col gap-4 text-base text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                    <FormField
                      control={form.control}
                      name="rememberMe"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center gap-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                              className="h-6 w-6 rounded-md border-slate-300"
                            />
                          </FormControl>
                          <FormLabel className="cursor-pointer text-lg font-medium text-slate-700">Recordarme</FormLabel>
                        </FormItem>
                      )}
                    />

                    <Link href="/forgot-password">
                      <span className="cursor-pointer text-lg font-medium text-[#2563eb] hover:underline">
                        Olvidaste tu contrasena?
                      </span>
                    </Link>
                  </div>

                  <Button
                    type="submit"
                    className="h-[68px] w-full rounded-2xl bg-[#062a58] text-2xl font-semibold text-white hover:bg-[#0b3267]"
                    disabled={loginMutation.isPending}
                  >
                    {loginMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                        Iniciando sesion
                      </>
                    ) : (
                      "Iniciar sesion"
                    )}
                  </Button>

                  <p className="pt-6 text-center text-lg leading-8 text-slate-600">
                    Necesitas ayuda? Contacta con el <span className="font-medium text-[#2563eb]">equipo de soporte</span>
                  </p>
                </form>
              </Form>
            </div>
          </aside>
        </div>

        <footer className="mt-4 rounded-t-[18px] bg-[#062a58] px-6 py-5 text-white lg:px-10">
          <div className="flex flex-col items-center justify-between gap-4 text-center text-base lg:flex-row lg:text-left lg:text-[20px]">
            <div className="flex items-center gap-3">
              <img src={meeLogo} alt="Macmillan Education" className="h-9 w-auto brightness-0 invert" />
              <span className="text-lg font-medium lg:text-[19px]">macmillan education</span>
            </div>
            <span className="font-medium">bridge.macmillan.es</span>
            <span>© 2024 Macmillan Education. Todos los derechos reservados.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
