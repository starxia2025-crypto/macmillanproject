import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { customFetch, useLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { getDefaultRouteForRole } from "@/lib/default-route";
import { toast } from "@/hooks/use-toast";
import meeLogo from "@/assets/mee-logo.svg";

const loginSchema = z.object({
  email: z.string().email("Introduce un correo electrónico válido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  captchaAnswer: z.string().optional(),
  rememberMe: z.boolean(),
});

const supportContactSchema = z.object({
  name: z.string().trim().min(2, "Introduce tu nombre"),
  email: z.string().trim().email("Introduce un correo válido"),
  phone: z.string().trim().max(40).optional(),
  schoolName: z.string().trim().max(160).optional(),
  subject: z.string().trim().min(3, "Indica un asunto breve"),
  message: z.string().trim().min(10, "Cuéntanos brevemente qué necesitas"),
});

const RECENT_LOGIN_EMAILS_STORAGE_KEY = "helpdesk-recent-login-emails";
const MAX_RECENT_LOGIN_EMAILS = 5;

type LoginFormValues = z.infer<typeof loginSchema>;
type SupportContactFormValues = z.infer<typeof supportContactSchema>;
type CaptchaChallenge = {
  question: string;
  token: string;
};

const capabilityItems = ["Soporte", "Recursos", "Solicitud de asistencia", "Formación", "API externa"];

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

function HeroWordmark() {
  return (
    <div className="max-w-[760px]">
      <div className="flex max-w-full flex-wrap items-baseline gap-x-2 pb-5 leading-[1.02]">
        <span className="text-[48px] font-semibold tracking-[-0.05em] text-white sm:text-[58px] lg:text-[80px]">Macmillan</span>
        <span className="bridge-word inline-block translate-y-[0.02em] overflow-visible pb-[0.14em] pr-[0.04em] text-[48px] font-bold tracking-[-0.06em] sm:text-[58px] lg:text-[80px]">
          Bridge
        </span>
      </div>
      <p className="mt-8 text-[23px] font-medium leading-tight text-white/96 sm:text-[28px] lg:text-[34px]">
        Plataforma de soporte y servicios
      </p>
    </div>
  );
}

function BackgroundRays() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(120deg,#03143f_0%,#08276e_32%,#1247a5_72%,#4c95ff_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_24%,rgba(125,195,255,0.42),rgba(53,122,244,0.22)_18%,rgba(10,40,115,0)_48%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_74%,rgba(36,81,190,0.24),rgba(5,26,83,0)_36%)]" />
      <div className="absolute inset-y-[-8%] left-[14%] right-[-16%] top-[8%] opacity-80">
        {Array.from({ length: 9 }).map((_, index) => (
          <div
            key={index}
            className="absolute left-0 h-px origin-left overflow-hidden rounded-full bg-gradient-to-r from-white/0 via-white/14 to-white/0"
            style={{
              top: `${10 + index * 9}%`,
              width: `${72 + index * 4}%`,
              transform: `rotate(${index * 5 - 19}deg)`,
            }}
          >
            <div
              className="absolute inset-y-0 -left-[26%] w-[18%] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.52),rgba(255,255,255,0))] blur-[1px]"
              style={{
                animation: `rayTravel ${10.5 + index * 0.85}s linear infinite`,
                animationDelay: `${index * 0.65}s`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,rgba(2,16,54,0),rgba(2,16,54,0.28)_48%,rgba(2,16,54,0.62)_100%)]" />
    </div>
  );
}

function CapabilityMarquee() {
  const marqueeItems = [...capabilityItems, ...capabilityItems, ...capabilityItems];

  return (
    <div className="mt-12 w-full max-w-[760px] overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.05] px-3 py-3 shadow-[0_24px_80px_-52px_rgba(5,18,56,0.95)] backdrop-blur-md sm:px-4">
      <div className="flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <div className="flex min-w-max animate-[capabilityMarquee_26s_linear_infinite] items-center gap-4 sm:gap-5">
          {marqueeItems.map((item, index) => (
            <div
              key={`${item}-${index}`}
              className="flex items-center gap-4 text-sm font-medium tracking-[0.04em] text-white/76 sm:text-[15px]"
            >
              <span className="whitespace-nowrap">{item}</span>
              <span className="text-white/28">{index === marqueeItems.length - 1 ? "" : "·"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MacmillanLogin() {
  const [, setLocation] = useLocation();
  const [captchaChallenge, setCaptchaChallenge] = useState<CaptchaChallenge | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);
  const [supportSent, setSupportSent] = useState(false);
  const currentYear = new Date().getFullYear();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", captchaAnswer: "", rememberMe: true },
  });

  const supportForm = useForm<SupportContactFormValues>({
    resolver: zodResolver(supportContactSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      schoolName: "",
      subject: "",
      message: "",
    },
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

  const supportMutation = useMutation({
    mutationFn: async (values: SupportContactFormValues) =>
      customFetch<{ message: string }>("/api/auth/support-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      }),
    onSuccess: (response) => {
      setSupportSent(true);
      toast({
        title: "Solicitud registrada",
        description: response.message,
      });
    },
    onError: (error) => {
      toast({
        title: "No se pudo registrar la solicitud",
        description: error instanceof Error ? error.message : "Inténtalo de nuevo en unos minutos.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    const emails = readRecentLoginEmails();
    if (emails[0] && !form.getValues("email")) {
      form.setValue("email", emails[0], { shouldValidate: false });
    }
  }, [form]);

  useEffect(() => {
    const loginEmail = form.getValues("email");
    if (loginEmail && !supportForm.getValues("email")) {
      supportForm.setValue("email", loginEmail, { shouldValidate: false });
    }
  }, [form, supportForm]);

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
      return "Credenciales no válidas";
    }

    if (rawMessage.toLowerCase().includes("failed to fetch")) {
      return "No se pudo conectar con el servidor. Inténtalo de nuevo en unos segundos.";
    }

    return "No se pudo iniciar sesión. Revisa tus datos e inténtalo de nuevo.";
  }

  function openSupportDialog() {
    setSupportSent(false);
    supportForm.reset({
      name: "",
      email: form.getValues("email") || "",
      phone: "",
      schoolName: "",
      subject: "",
      message: "",
    });
    setSupportDialogOpen(true);
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[linear-gradient(115deg,#041955_0%,#072a82_30%,#0f42b0_64%,#2d7fff_100%)]">
      <style>{`
        .bridge-word {
          color: transparent;
          background-image:
            linear-gradient(90deg,
              #ff7a00 0%,
              #ff8510 22%,
              #ffd1a3 34%,
              #ff9a32 44%,
              #ff7a00 56%,
              #ff8a18 70%,
              #ffd9b5 82%,
              #ff7a00 100%);
          background-size: 240% 100%;
          background-position: 115% 50%;
          -webkit-background-clip: text;
          background-clip: text;
          filter: drop-shadow(0 8px 22px rgba(255,122,0,0.18));
          animation:
            bridgeInnerGlow 5.8s cubic-bezier(0.42, 0, 0.18, 1) infinite,
            bridgePulse 5.8s ease-in-out infinite;
        }
        @keyframes bridgeInnerGlow {
          0%, 18% {
            background-position: 118% 50%;
          }
          56%, 74% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
        @keyframes bridgePulse {
          0%, 54%, 100% {
            filter: drop-shadow(0 8px 22px rgba(255,122,0,0.18)) brightness(1);
          }
          63%, 74% {
            filter: drop-shadow(0 10px 28px rgba(255,122,0,0.24)) brightness(1.08);
          }
        }
        @keyframes rayTravel {
          0% { transform: translateX(0); opacity: 0; }
          10% { opacity: 0.72; }
          84% { opacity: 0.18; }
          100% { transform: translateX(760%); opacity: 0; }
        }
        @keyframes capabilityMarquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-33.333%); }
        }
      `}</style>
      <div className="relative mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-4 lg:px-6 lg:py-5">
        <BackgroundRays />

        <div className="relative grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_430px] lg:items-center lg:gap-10">
          <section className="flex min-h-0 flex-col justify-between py-4 lg:py-8">
            <div className="max-w-[820px]">
              <HeroWordmark />

              <p className="mt-10 max-w-[690px] text-[20px] leading-[1.7] text-white/78 sm:text-[22px] lg:text-[24px]">
                Bridge refuerza nuestro soporte con una plataforma centralizada diseñada para ofrecer a clientes clave una experiencia de atención más cercana, trazable y personalizada.
              </p>
            </div>

            <CapabilityMarquee />
          </section>

          <aside className="flex items-center justify-center">
            <div className="w-full rounded-[28px] border border-white/75 bg-white/98 p-7 shadow-[0_28px_80px_-36px_rgba(4,10,31,0.72)] lg:p-8">
              <div className="text-center">
                <h2 className="text-[42px] font-bold tracking-tight text-[#082c63] lg:text-[56px]">Bienvenido</h2>
                <p className="mt-2 text-[16px] text-slate-600 lg:text-[18px]">Inicia sesión para continuar</p>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 space-y-5">
                  {loginMutation.isError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                      {getLoginErrorMessage()}
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[15px] font-semibold text-[#082c63]">Correo electrónico</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                            <Input
                              placeholder="usuario@macmillan.com"
                              {...field}
                              className="h-12 rounded-xl border-slate-200 pl-12 text-[16px] text-slate-700 placeholder:text-slate-400"
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
                        <FormLabel className="text-[15px] font-semibold text-[#082c63]">Contraseña</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="••••••••••"
                              {...field}
                              className="h-12 rounded-xl border-slate-200 pl-12 pr-12 text-[16px] text-slate-700 placeholder:text-slate-400"
                            />
                            <button
                              type="button"
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
                              onClick={() => setShowPassword((current) => !current)}
                              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                            >
                              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
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
                          <FormLabel className="text-[15px] font-semibold text-[#082c63]">Verificación de seguridad</FormLabel>
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                            <p className="mb-2 text-sm font-medium text-amber-900">
                              Resuelve para continuar: <span className="font-bold">{captchaChallenge.question}</span>
                            </p>
                            <FormControl>
                              <Input inputMode="numeric" placeholder="Resultado" {...field} className="h-11 rounded-lg bg-white text-[15px]" />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <div className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                    <FormField
                      control={form.control}
                      name="rememberMe"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center gap-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                              className="h-5 w-5 rounded-md border-slate-300"
                            />
                          </FormControl>
                          <FormLabel className="cursor-pointer text-[14px] font-medium text-slate-700">Recordarme</FormLabel>
                        </FormItem>
                      )}
                    />

                    <Link href="/forgot-password">
                      <span className="cursor-pointer text-[14px] font-medium text-[#2563eb] hover:underline">
                        ¿Olvidaste tu contraseña?
                      </span>
                    </Link>
                  </div>

                  <Button
                    type="submit"
                    className="h-12 w-full rounded-xl bg-[#0a2d60] text-[18px] font-semibold text-white hover:bg-[#11356c]"
                    disabled={loginMutation.isPending}
                  >
                    {loginMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Iniciando sesión
                      </>
                    ) : (
                      "Iniciar sesión"
                    )}
                  </Button>

                  <div className="flex items-center gap-3 pt-1">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span className="text-xs text-slate-400">o</span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>

                  <p className="pt-2 text-center text-[14px] leading-6 text-slate-700">
                    ¿Necesitas ayuda? Contacta con el{" "}
                    <button
                      type="button"
                      className="font-medium text-[#2563eb] hover:underline"
                      onClick={openSupportDialog}
                    >
                      equipo de soporte
                    </button>
                  </p>
                </form>
              </Form>
            </div>
          </aside>
        </div>

        <footer className="relative mt-4 rounded-[18px] bg-[#07245d]/92 px-5 py-4 text-white backdrop-blur-sm">
          <div className="flex flex-col items-center justify-between gap-3 text-center text-[14px] lg:flex-row lg:text-left lg:text-[15px]">
            <div className="flex items-center gap-3">
              <img src={meeLogo} alt="Macmillan Education" className="h-7 w-auto brightness-0 invert" />
              <span className="font-medium">macmillan education</span>
            </div>
            <span>&copy; {currentYear} Macmillan Education. Todos los derechos reservados.</span>
          </div>
        </footer>

        <Dialog
          open={supportDialogOpen}
          onOpenChange={(open) => {
            setSupportDialogOpen(open);
            if (!open) {
              setSupportSent(false);
            }
          }}
        >
          <DialogContent className="max-w-xl rounded-2xl">
            <DialogHeader>
              <DialogTitle>Contactar con soporte</DialogTitle>
              <DialogDescription>
                Rellena este formulario y registraremos una consulta para que el equipo de soporte la vea directamente en Bridge.
              </DialogDescription>
            </DialogHeader>

            {supportSent ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-sm text-emerald-800">
                  Tu solicitud se ha registrado correctamente en el sistema de soporte. El equipo la revisará lo antes posible.
                </div>
                <DialogFooter>
                  <Button type="button" onClick={() => setSupportDialogOpen(false)}>
                    Cerrar
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <Form {...supportForm}>
                <form
                  onSubmit={supportForm.handleSubmit((values) => supportMutation.mutate(values))}
                  className="space-y-4"
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={supportForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nombre</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Tu nombre" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={supportForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Correo electrónico</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="tu@colegio.es" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={supportForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Teléfono</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Opcional" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={supportForm.control}
                      name="schoolName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Colegio o centro</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Opcional" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={supportForm.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Asunto</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Necesito ayuda para acceder a la plataforma" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={supportForm.control}
                    name="message"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mensaje</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder="Describe brevemente lo que necesitas y, si puedes, indica el problema o la consulta."
                            className="min-h-[140px]"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setSupportDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={supportMutation.isPending}>
                      {supportMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        "Registrar solicitud"
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}




