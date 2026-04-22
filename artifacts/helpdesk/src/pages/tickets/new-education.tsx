import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ApiError,
  customFetch,
  useCreateTicket,
  useGetTenant,
  useListTenants,
  useGetMe,
  TicketPriority,
} from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft,
  Loader2,
  RefreshCcw,
  TriangleAlert,
  Building2,
  Undo2,
  BookX,
  Backpack,
  Mail,
  Hash,
  HelpCircle,
  Search,
  CheckCircle2,
  KeyRound,
  Copy,
  ShieldCheck,
  Clock3,
  Users,
  School,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

const educationTicketSchema = z.object({
  studentEmail: z.string().trim().email("Indica el correo del alumno"),
  schoolId: z.coerce.number().optional(),
  reporterEmail: z.union([z.literal(""), z.string().trim().email("Indica un correo valido")]).optional(),
  subjectType: z.enum(["Alumno", "Docente", "SobreMiCuenta"]).optional(),
  studentEnrollment: z.string().optional(),
  stage: z.string().optional(),
  course: z.string().optional(),
  subject: z.enum(["Inglés", "Alemán", "Francés", "Todas"]).optional(),
  inquiryType: z.enum(["Alumno sin libros", "No puede acceder", "Problemas de activación", "No funciona el libro", "Otro"]).optional(),
  description: z.string().optional(),
  observations: z.string().optional(),
  priority: z.enum(["baja", "media", "alta", "urgente"] as const).optional(),
  tenantId: z.coerce.number().optional(),
}).superRefine((values, ctx) => {
  if (!values.subjectType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subjectType"],
      message: "Selecciona si la consulta es sobre un alumno, un docente o sobre tu cuenta",
    });
  }
});

type EducationTicketFormValues = z.infer<typeof educationTicketSchema>;

type MochilaLookupResult = {
  studentEmail: string;
  studentName: string | null;
  studentSurname: string | null;
  studentUser: string | null;
  studentPassword: string | null;
  token: string | null;
  schools: string[];
  records: Array<{
    schoolName: string | null;
    studentName: string | null;
    studentSurname: string | null;
    studentEmail: string | null;
    studentUser: string | null;
    studentPassword: string | null;
    token: string | null;
    description: string | null;
    ean: string | null;
    idOrder: string | null;
    idConsignaOrder: number;
    esGoogle: boolean | null;
  }>;
};

type ReturnCandidate = {
  key: string;
  description: string;
  isbn: string;
  orderId: string;
  google: string;
  bookCode: string;
};
type StudentLineAction = "return" | "missing_book";

const FORGOT_PASSWORD_URL = "https://identity.macmillaneducationeverywhere.com/forgot-password?returnUrl=%2Fconnect%2Fauthorize%2Fcallback%3Fclient_id%3D21%26redirect_uri%3Dhttps%253A%252F%252Fliveapi.macmillaneducationeverywhere.com%252Fapi%252Foidcintegration%252Fcode%26response_type%3Dcode%26scope%3Dopenid%2520profile%2520offline_access%26code_challenge_method%3DS256%26code_challenge%3Dno-81rQrMJwoLhRrryqaEx7ZBNWokrmhhAD98uIz5fo%26state%3Daf32b1c7-a894-47d9-842f-73d9fff373f7";
const BLINK_PASSWORD_URL = "https://www.blinklearning.com/v/1774948299/themes/tmpux/launch.php";

function inferMochilaDescription(record: MochilaLookupResult["records"][number]) {
  if (record.description?.trim()) return record.description.trim();
  return (record.token?.trim().length ?? 0) > 15 ? "Inglés" : "Francés/Alemán";
}

function getTokenLength(record: MochilaLookupResult["records"][number]) {
  return record.token?.trim().length ?? 0;
}

function getMochilaOrderId(lookup: MochilaLookupResult | null) {
  return lookup?.records.find((record) => record.idOrder !== null && record.idOrder !== undefined)?.idOrder?.trim() ?? "";
}

function normalizeSchoolLabel(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getInitials(name: string | null, surname: string | null, fallbackEmail: string | null) {
  const fullName = [name, surname].filter(Boolean).join(" ").trim();
  if (fullName) {
    return fullName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  const fallback = fallbackEmail?.trim() || "";
  return fallback.slice(0, 2).toUpperCase() || "AL";
}

function getAlumnoInquiryTypeFromActions(selectedItems: Array<{ actions: StudentLineAction[] }>) {
  const selectedIssueTypes = Array.from(
    new Set(
      selectedItems.flatMap((item) =>
        item.actions.map((action) => (action === "return" ? "Devolucion" : "No ve el libro"))
      )
    )
  );

  if (selectedIssueTypes.length === 0) return "Otras";
  if (selectedIssueTypes.length > 1) return "Varios";
  return selectedIssueTypes[0]!;
}

function LanguageFlag({ kind }: { kind: "english" | "frde" }) {
  if (kind === "english") {
    return (
      <div className="relative h-10 w-10 overflow-hidden rounded-full border border-amber-200 bg-[#1f3f95] shadow-sm">
        <div className="absolute inset-x-0 top-[42%] h-[16%] bg-white" />
        <div className="absolute inset-y-0 left-[42%] w-[16%] bg-white" />
        <div className="absolute inset-x-0 top-[46%] h-[8%] bg-[#d62828]" />
        <div className="absolute inset-y-0 left-[46%] w-[8%] bg-[#d62828]" />
      </div>
    );
  }

  return (
    <div className="flex h-10 w-10 flex-col overflow-hidden rounded-full border border-amber-200 bg-white shadow-sm">
      <div className="flex h-1/2 w-full overflow-hidden">
        <div className="h-full flex-1 bg-[#1f4fbf]" />
        <div className="h-full flex-1 bg-white" />
        <div className="h-full flex-1 bg-[#e53935]" />
      </div>
      <div className="flex h-1/2 w-full flex-col">
        <div className="h-1/3 w-full bg-black" />
        <div className="h-1/3 w-full bg-[#d62828]" />
        <div className="h-1/3 w-full bg-[#ffce00]" />
      </div>
    </div>
  );
}

export default function NewEducationTicket() {
  const [, setLocation] = useLocation();
  const { data: user } = useGetMe();
  const [mochilaLookup, setMochilaLookup] = useState<MochilaLookupResult | null>(null);
  const [mochilaLookupError, setMochilaLookupError] = useState<string | null>(null);
  const [isLookingUpMochila, setIsLookingUpMochila] = useState(false);
  const [mochilaActivationSuggested, setMochilaActivationSuggested] = useState(false);
  const [, setMochilaLookupMode] = useState<"email" | "order">("email");
  const [mochilaOrderId, setMochilaOrderId] = useState("");
  const [showTeacherRegistrationRequest, setShowTeacherRegistrationRequest] = useState(false);
  const [teacherRegistrationNotes, setTeacherRegistrationNotes] = useState("");
  const [showChangeEmailDialog, setShowChangeEmailDialog] = useState(false);
  const [requestedStudentEmail, setRequestedStudentEmail] = useState("");
  const [requestedStudentEmailError, setRequestedStudentEmailError] = useState<string | null>(null);
  const [selectedLineActions, setSelectedLineActions] = useState<Record<string, StudentLineAction[]>>({});

  const { data: tenants } = useListTenants(
    { limit: 100 },
    { query: { enabled: user?.role === "superadmin" || user?.role === "tecnico" } },
  );
  const { data: currentTenant } = useGetTenant(user?.tenantId ?? 0, {
    query: { enabled: !!user?.tenantId && user?.role !== "superadmin" && user?.role !== "tecnico" },
  });

  const availableTenants = user?.role === "superadmin" || user?.role === "tecnico"
    ? tenants?.data ?? []
    : currentTenant ? [currentTenant] : [];

  const form = useForm<EducationTicketFormValues>({
    resolver: zodResolver(educationTicketSchema),
    defaultValues: {
      studentEmail: "",
      schoolId: user?.schoolId ?? undefined,
      reporterEmail: "",
      subjectType: undefined,
      studentEnrollment: "",
      stage: "",
      course: "",
      subject: "Inglés",
      inquiryType: "Alumno sin libros",
      description: "",
      observations: "",
      priority: "media",
      tenantId: user?.tenantId ?? undefined,
    },
  });

  const selectedTenantId = form.watch("tenantId");
  const selectedSchoolId = form.watch("schoolId");
  const studentEmail = form.watch("studentEmail");
  const subjectType = form.watch("subjectType");
  const supportsTeacherSubject = ["visor_cliente", "admin_cliente", "manager", "usuario_cliente"].includes(user?.role || "");
  const isTeacherSubject = subjectType === "Docente";
  const isOwnAccountSubject = subjectType === "SobreMiCuenta";
  const hasSelectedSubjectType =
    subjectType === "Alumno" || isTeacherSubject || isOwnAccountSubject;
  const usesSchoolReporterFlow = user?.role === "usuario_cliente" || user?.role === "visor_cliente";
  const useSessionSchool = user?.scopeType === "school" || usesSchoolReporterFlow;
  const hideReporterEmailField = usesSchoolReporterFlow;
  const selectedTenant =
    availableTenants.find((tenant) => tenant.id === selectedTenantId) ??
    availableTenants.find((tenant) => tenant.id === user?.tenantId) ??
    currentTenant;
  const tenantPanelBackground = (user as any)?.tenantSidebarBackgroundColor || selectedTenant?.sidebarBackgroundColor || "#0f172a";
  const tenantPanelText = (user as any)?.tenantSidebarTextColor || selectedTenant?.sidebarTextColor || "#ffffff";
  const tenantPanelMuted = tenantPanelText === "#ffffff" || tenantPanelText === "#f8fafc" ? "rgba(255,255,255,0.78)" : "rgba(15,23,42,0.72)";
  const tenantPanelBorder = tenantPanelText === "#ffffff" || tenantPanelText === "#f8fafc" ? "rgba(255,255,255,0.18)" : "rgba(15,23,42,0.1)";
    const panelInputStyle = {
      backgroundColor: "#ffffff",
      borderColor: "rgba(255,255,255,0.92)",
      color: "#0f172a",
      caretColor: "#0f172a",
      ["--autofill-bg" as string]: "#ffffff",
      ["--autofill-color" as string]: "#0f172a",
    } as const;
  const mochilasPanelBackground = tenantPanelBackground;
  const mochilasPanelBorder = tenantPanelBorder;
  const mochilasEnabled = Boolean(selectedTenant?.hasMochilasAccess ?? (user as any)?.tenantHasMochilasAccess);
  const orderLookupEnabled = Boolean(selectedTenant?.hasOrderLookup ?? (user as any)?.tenantHasOrderLookup);
  const returnsEnabled = Boolean(
    selectedTenant?.hasReturnsAccess ??
      (selectedTenant as any)?.has_returns_access ??
      (user as any)?.tenantHasReturnsAccess ??
      (user as any)?.tenant_has_returns_access
  );
  const shouldShowMochilasLookup = hasSelectedSubjectType && subjectType === "Alumno" && (mochilasEnabled || orderLookupEnabled || useSessionSchool);
  const tenantSchools = (selectedTenant?.schools ?? []).filter((school) => school.active);
  const selectedSchool = tenantSchools.find((school) => school.id === selectedSchoolId);
  const detectedMochilaSchool = tenantSchools.find((school) => {
    const normalizedSchool = normalizeSchoolLabel(school.name);
    return mochilaLookup?.schools.some((mochilaSchool) => {
      const normalizedMochilaSchool = normalizeSchoolLabel(mochilaSchool);
      return (
        normalizedSchool === normalizedMochilaSchool ||
        (normalizedSchool.length > 4 && normalizedMochilaSchool.includes(normalizedSchool)) ||
        (normalizedMochilaSchool.length > 4 && normalizedSchool.includes(normalizedMochilaSchool))
      );
    });
  });
  const shouldUseSimplifiedAlumnoFlow = subjectType === "Alumno" && shouldShowMochilasLookup && !!mochilaLookup;
  const shouldHideExtendedFields =
    !hasSelectedSubjectType ||
    isTeacherSubject ||
    isOwnAccountSubject ||
    shouldUseSimplifiedAlumnoFlow ||
    (subjectType === "Alumno" && shouldShowMochilasLookup && !mochilaLookup);
  const shouldShowTeacherTicketFields = isTeacherSubject;
  const shouldShowOwnAccountFields = isOwnAccountSubject;
  const canSubmitForm =
    shouldShowTeacherTicketFields ||
    shouldShowOwnAccountFields ||
    !shouldHideExtendedFields ||
    shouldUseSimplifiedAlumnoFlow;

  useEffect(() => {
    if (!mochilaLookup) return;

    requestAnimationFrame(() => {
      const node = document.getElementById("mochila-result-card");
      if (!node) return;

      const rect = node.getBoundingClientRect();
      const targetTop = window.scrollY + rect.top - Math.max(48, (window.innerHeight - rect.height) / 2);

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth",
      });
    });
  }, [mochilaLookup]);

  const summarizedMochilaRecords = useMemo(() => {
    if (!mochilaLookup) return [];

    return mochilaLookup.records.map((record, index) => ({
      key: `${record.idConsignaOrder}-${record.ean?.trim() || "-"}-${record.token?.trim() || "-"}-${index}`,
      description: inferMochilaDescription(record),
      isbn: record.ean?.trim() || "-",
      orderId: record.idOrder?.trim() || String(record.idConsignaOrder),
      google: record.esGoogle === null ? "-" : record.esGoogle ? "Si" : "No",
      bookCode: record.token?.trim() || "-",
    }));
  }, [mochilaLookup]);
  const selectedActionItems = useMemo(
    () =>
      summarizedMochilaRecords
        .filter((record) => (selectedLineActions[record.key] ?? []).length > 0)
        .map((record) => ({
          ...record,
          actions: selectedLineActions[record.key] ?? [],
        })),
    [selectedLineActions, summarizedMochilaRecords]
  );
  const selectedReturnItems = useMemo(
    () => selectedActionItems.filter((record) => record.actions.includes("return")),
    [selectedActionItems]
  );
  const studentEnglishCredential = useMemo(() => {
    if (!mochilaLookup) return null;

    const record = mochilaLookup.records.find((item) => getTokenLength(item) > 15);
    if (!record) return null;

    return {
      user: record.studentUser?.trim() || mochilaLookup.studentUser || null,
      password: record.studentPassword?.trim() || null,
    };
  }, [mochilaLookup]);
  const studentBlinkCredential = useMemo(() => {
    if (!mochilaLookup) return null;

    const record = mochilaLookup.records.find((item) => {
      const tokenLength = getTokenLength(item);
      return tokenLength > 0 && tokenLength <= 15;
    });
    if (!record) return null;

    return {
      user: record.studentUser?.trim() || mochilaLookup.studentUser || null,
      password: record.studentPassword?.trim() || null,
    };
  }, [mochilaLookup]);

  useEffect(() => {
    if (!user) return;

    if (user.tenantId) {
      form.setValue("tenantId", user.tenantId);
    }

    if (useSessionSchool && user.schoolId) {
      form.setValue("schoolId", user.schoolId);
    }

    if (hideReporterEmailField && user.email) {
      form.setValue("reporterEmail", user.email);
    }

    if (subjectType === "SobreMiCuenta" && user.email) {
      form.setValue("studentEmail", user.email);
    }
  }, [form, hideReporterEmailField, subjectType, useSessionSchool, user]);

  useEffect(() => {
    if (subjectType !== "Alumno") {
      setMochilaLookupMode("email");
      setMochilaOrderId("");
    }
  }, [subjectType]);

  useEffect(() => {
    if (subjectType !== "Alumno") return;
    if (!(mochilasEnabled || useSessionSchool) && orderLookupEnabled) {
      setMochilaLookupMode("order");
    }
  }, [mochilasEnabled, orderLookupEnabled, subjectType, useSessionSchool]);

  useEffect(() => {
    if (!detectedMochilaSchool?.id || selectedSchoolId) return;
    form.setValue("schoolId", detectedMochilaSchool.id, { shouldValidate: true });
  }, [detectedMochilaSchool?.id, form, selectedSchoolId]);

  const createMutation = useCreateTicket({
    mutation: {
      onSuccess: (data) => {
        setLocation(`/tickets/${data.id}`);
      },
      onError: (error) => {
        toast({
          title: "No se pudo crear la consulta",
          description: error instanceof Error ? error.message : "Revisa los datos e inténtalo de nuevo.",
          variant: "destructive",
        });
      },
    },
  });

  const quickAccessIssueMutation = useCreateTicket({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Consulta creada",
          description: "Hemos registrado la incidencia de acceso y te llevamos al listado de tickets.",
        });
        setLocation("/tickets");
      },
      onError: (error) => {
        toast({
          title: "No se pudo crear la consulta",
          description: error instanceof Error ? error.message : "Intentalo de nuevo.",
          variant: "destructive",
        });
      },
    },
  });

  async function lookupStudentInMochilas() {
    const normalizedEmail = studentEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      form.setError("studentEmail", {
        type: "manual",
        message: "Indica el correo del alumno",
      });
      return;
    }

    setIsLookingUpMochila(true);
    setMochilaLookup(null);
    setMochilaLookupError(null);
    setMochilaActivationSuggested(false);
    setSelectedLineActions({});

    try {
      const params = new URLSearchParams({ email: normalizedEmail });
      const effectiveTenantId = selectedTenantId || user?.tenantId;
      if (effectiveTenantId) {
        params.set("tenantId", String(effectiveTenantId));
      }

      const result = await customFetch<MochilaLookupResult>(`/api/tickets/mochilas/student?${params.toString()}`);
      setMochilaLookup(result);
    } catch (error) {
      const outsideTenant =
        error instanceof ApiError &&
        error.status === 404 &&
        error.message.toLowerCase().includes("no pertenece a ningun centro de la red educativa");
      const message =
        error instanceof ApiError && error.status === 404 && !outsideTenant
          ? "No existe informacion del alumno en Mochilas o su compra aun no ha sido activada."
          : error instanceof Error
            ? error.message
            : "No se pudo consultar la informacion de Mochilas.";

      if (error instanceof ApiError && error.status === 404 && !outsideTenant) {
        setMochilaActivationSuggested(true);
      }

      setMochilaLookupError(message);
      toast({
        title: "No se pudo consultar Mochilas",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLookingUpMochila(false);
    }
  }

  async function lookupStudentByOrderInMochilas() {
    const normalizedOrderId = mochilaOrderId.trim();
    if (!normalizedOrderId) {
      setMochilaLookupError("Indica un pedido valido.");
      return;
    }

    setIsLookingUpMochila(true);
    setMochilaLookup(null);
    setMochilaLookupError(null);
    setMochilaActivationSuggested(false);
    setSelectedLineActions({});

    try {
      const params = new URLSearchParams({ orderId: normalizedOrderId });
      const effectiveTenantId = selectedTenantId || user?.tenantId;
      if (effectiveTenantId) {
        params.set("tenantId", String(effectiveTenantId));
      }

      const result = await customFetch<MochilaLookupResult>(`/api/tickets/mochilas/order?${params.toString()}`);
      setMochilaLookup(result);
      if (result.studentEmail) {
        form.setValue("studentEmail", result.studentEmail);
      }
    } catch (error) {
      const outsideTenant =
        error instanceof ApiError &&
        error.status === 404 &&
        error.message.toLowerCase().includes("no pertenece a ningun centro de la red educativa");
      const message =
        error instanceof ApiError && error.status === 404 && !outsideTenant
          ? "Pedido no encontrado. No es mochila, o no ha sido procesado aun."
          : error instanceof Error
            ? error.message
            : "No se pudo consultar la informacion del pedido en Mochilas.";

      setMochilaLookupError(message);
      toast({
        title: "No se pudo consultar el pedido",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLookingUpMochila(false);
    }
  }

  async function openRecoveryUrl(url: string, email: string, successTitle: string, successDescription: string) {
    if (!email) {
      form.setError("studentEmail", {
        type: "manual",
        message: subjectType === "Docente" ? "Indica primero el email de acceso del docente" : "Indica primero el correo del alumno",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(email);
      toast({
        title: successTitle,
        description: successDescription,
      });
    } catch {
      toast({
        title: "Abriendo recuperación de contraseña",
        description: "Si no se copia automáticamente, pégalo manualmente en la página externa.",
      });
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleForgotTeacherEnglishPassword() {
    await openRecoveryUrl(
      FORGOT_PASSWORD_URL,
      studentEmail.trim(),
      "Correo del docente copiado",
      "Se ha copiado el email de acceso del docente para que puedas pegarlo en la pantalla de recuperación."
    );
  }

  async function handleForgotTeacherBlinkPassword() {
    await openRecoveryUrl(
      BLINK_PASSWORD_URL,
      studentEmail.trim(),
      "Correo del docente copiado",
      "Se ha copiado el email de acceso del docente para que puedas pegarlo en BlinkLearning."
    );
  }

  async function handleForgotStudentEnglishPassword() {
    await openRecoveryUrl(
      FORGOT_PASSWORD_URL,
      mochilaLookup?.studentEmail?.trim() || studentEmail.trim(),
      "Correo del alumno copiado",
      "Se ha copiado el email del alumno para que puedas pegarlo en la recuperación de contraseña de Inglés."
    );
  }

  async function handleForgotStudentBlinkPassword() {
    await openRecoveryUrl(
      BLINK_PASSWORD_URL,
      mochilaLookup?.studentEmail?.trim() || studentEmail.trim(),
      "Correo del alumno copiado",
      "Se ha copiado el email del alumno para que puedas pegarlo en BlinkLearning."
    );
  }

  function openChangeStudentEmailDialog() {
    const normalizedStudentEmail = (mochilaLookup?.studentEmail || form.getValues("studentEmail")).trim().toLowerCase();
    if (!normalizedStudentEmail) {
      form.setError("studentEmail", {
        type: "manual",
        message: "Indica primero el correo del alumno",
      });
      return;
    }

    setRequestedStudentEmail("");
    setRequestedStudentEmailError(null);
    setShowChangeEmailDialog(true);
  }

  function handleChangeStudentEmail() {
    const normalizedStudentEmail = (mochilaLookup?.studentEmail || form.getValues("studentEmail")).trim().toLowerCase();
    const normalizedRequestedEmail = requestedStudentEmail.trim().toLowerCase();
    const emailValidation = z.string().email("Indica un email valido").safeParse(normalizedRequestedEmail);

    if (!emailValidation.success) {
      setRequestedStudentEmailError("Indica un email valido");
      return;
    }

    const ticketSchool = selectedSchool ?? detectedMochilaSchool;
    const schoolName = ticketSchool?.name || mochilaLookup?.schools[0] || user?.schoolName || "Colegio";
    const tenantId =
      user?.scopeType === "global"
        ? (selectedTenantId as number)
        : (user?.tenantId as number);

    const schoolId =
      useSessionSchool
        ? (user?.schoolId as number)
        : ((ticketSchool?.id ?? selectedSchoolId) as number);

    const actionTitle = "Modificar correo";

    quickAccessIssueMutation.mutate({
      data: {
        title: actionTitle,
        description: [
          `Colegio: ${schoolName}`,
          `Email actual: ${normalizedStudentEmail}`,
          `Email solicitado: ${normalizedRequestedEmail}`,
          `Informador: ${user?.email ?? "-"}`,
          "Accion solicitada: Modificar el correo del alumno.",
        ].join("\n"),
        priority: TicketPriority.media,
        category: "modificar_correo",
        customFields: {
          school: schoolName,
          studentEmail: normalizedStudentEmail,
          affectedEmail: normalizedStudentEmail,
          currentStudentEmail: normalizedStudentEmail,
          newStudentEmail: normalizedRequestedEmail,
          reporterEmail: user?.email ?? null,
          subjectType: "Alumno",
          inquiryType: actionTitle,
          mochilaLookup,
          changeEmailRequested: true,
        },
        tenantId,
        schoolId,
      },
    });

    setShowChangeEmailDialog(false);
    setRequestedStudentEmail("");
    setRequestedStudentEmailError(null);
  }

  function createTeacherRegistrationTicket() {
    const teacherEmail = (user?.email || studentEmail).trim().toLowerCase();
    if (!teacherEmail) {
      toast({
        title: "No se pudo crear la solicitud",
        description: "No hemos podido identificar el correo del docente que solicita el alta.",
        variant: "destructive",
      });
      return;
    }

    const schoolName = selectedSchool?.name || user?.schoolName || "Colegio";
    const tenantId =
      user?.scopeType === "global"
        ? (selectedTenantId as number)
        : (user?.tenantId as number);

    const schoolId =
      useSessionSchool
        ? (user?.schoolId as number)
        : (selectedSchoolId as number);

    quickAccessIssueMutation.mutate({
      data: {
        title: `${schoolName} - Solicitud de alta docente`,
        description: [
          `Colegio: ${schoolName}`,
          `Docente: ${teacherEmail}`,
          `Informador: ${user?.email ?? "-"}`,
          "Motivo: El docente solicita alta o activacion inicial de acceso.",
          teacherRegistrationNotes.trim() ? `Datos facilitados: ${teacherRegistrationNotes.trim()}` : null,
        ].filter(Boolean).join("\n"),
        priority: TicketPriority.media,
        category: "alta_docente",
          customFields: {
            school: schoolName,
            teacherEmail,
            affectedEmail: teacherEmail,
            reporterEmail: user?.email ?? null,
            subjectType: "Docente",
            inquiryType: "Alta docente",
            teacherRegistrationRequested: true,
            teacherRegistrationNotes: teacherRegistrationNotes.trim() || null,
          },
        tenantId,
        schoolId,
      },
    });
  }

  function createTeacherDirectTicket(kind: "access" | "registration") {
    const values = form.getValues();
    const teacherEmail = values.studentEmail.trim().toLowerCase();
    const teacherDescription = values.description?.trim() || "";

    if (!teacherEmail) {
      form.setError("studentEmail", {
        type: "manual",
        message: "Indica el correo del docente",
      });
      return;
    }

    if (!teacherDescription) {
      form.setError("description", {
        type: "manual",
        message: kind === "registration"
          ? "Añade una breve explicación para la solicitud de alta"
          : "Describe brevemente lo que le sucede al docente",
      });
      return;
    }

    const schoolName = selectedSchool?.name || user?.schoolName || "Colegio";
    const tenantId =
      user?.scopeType === "global"
        ? (selectedTenantId as number)
        : (user?.tenantId as number);

    const schoolId =
      useSessionSchool
        ? (user?.schoolId as number)
        : (selectedSchoolId as number);

      quickAccessIssueMutation.mutate({
        data: {
          title:
            kind === "registration" ? "Alta docente" : "No puede acceder",
        description: [
          `Colegio: ${schoolName}`,
          `Docente: ${teacherEmail}`,
          `Informador: ${user?.email ?? "-"}`,
          `Prioridad: ${values.priority ?? TicketPriority.media}`,
          kind === "registration"
            ? "Motivo: Solicitud de alta o activación inicial para docente."
            : "Motivo: El docente no puede acceder a la plataforma.",
          `Descripción: ${teacherDescription}`,
        ].join("\n"),
        priority: values.priority ?? TicketPriority.media,
        category: kind === "registration" ? "alta_docente" : "acceso_docente",
          customFields: {
            school: schoolName,
            teacherEmail,
            affectedEmail: teacherEmail,
            reporterEmail: user?.email ?? null,
            subjectType: "Docente",
            inquiryType: kind === "registration" ? "Alta docente" : "No puede acceder",
            teacherRegistrationRequested: kind === "registration",
            teacherRegistrationNotes: kind === "registration" ? teacherDescription : null,
            description: teacherDescription,
        },
        tenantId,
        schoolId,
      },
    });
  }

  function createAccessIssueTicket() {
    const normalizedStudentEmail = (mochilaLookup?.studentEmail || form.getValues("studentEmail")).trim().toLowerCase();
    if (!normalizedStudentEmail) {
      form.setError("studentEmail", {
        type: "manual",
        message: subjectType === "Docente" ? "Indica primero el email de acceso del docente" : "Indica primero el correo del alumno",
      });
      return;
    }

    const ticketSchool = selectedSchool ?? detectedMochilaSchool;
    const schoolName = ticketSchool?.name || mochilaLookup?.schools[0] || user?.schoolName || "Colegio";
    const tenantId =
      user?.scopeType === "global"
        ? (selectedTenantId as number)
        : (user?.tenantId as number);

    const schoolId =
      useSessionSchool
        ? (user?.schoolId as number)
        : ((ticketSchool?.id ?? selectedSchoolId) as number);

    const actionTitle = "No puede acceder";
    const orderId = getMochilaOrderId(mochilaLookup);

      quickAccessIssueMutation.mutate({
        data: {
          title: actionTitle,
        description: [
          `Colegio: ${schoolName}`,
          `${subjectType}: ${normalizedStudentEmail}`,
          `Informador: ${user?.email ?? "-"}`,
          `Motivo: Tras la revision inicial y la recuperacion de contrasena, ${subjectType === "Docente" ? "el docente" : subjectType === "SobreMiCuenta" ? "el usuario" : "el alumno"} aun no puede acceder.`,
          "Accion solicitada: Revision tecnica prioritaria del acceso en Mochilas.",
        ].join("\n"),
        priority: TicketPriority.alta,
        category: "seguimiento_acceso_mochilas",
        customFields: {
          school: schoolName,
          orderId,
          studentEmail: subjectType === "Alumno" ? normalizedStudentEmail : null,
            teacherEmail: subjectType === "Docente" ? normalizedStudentEmail : null,
          affectedEmail: normalizedStudentEmail,
            reporterEmail: user?.email ?? null,
            subjectType,
            inquiryType: actionTitle,
            mochilaLookup,
          accessFollowUpRequested: true,
        },
        tenantId,
        schoolId,
      },
    });
  }

  function createUrgentActivationTicket() {
    const normalizedStudentEmail = form.getValues("studentEmail").trim().toLowerCase();
    if (!normalizedStudentEmail) {
      form.setError("studentEmail", {
        type: "manual",
        message: "Indica el correo del alumno",
      });
      return;
    }

    const schoolName = selectedSchool?.name || user?.schoolName || "Colegio";
    const tenantId =
      user?.scopeType === "global"
        ? (selectedTenantId as number)
        : (user?.tenantId as number);

    const schoolId =
      useSessionSchool
        ? (user?.schoolId as number)
        : (selectedSchoolId as number);

    createMutation.mutate({
      data: {
        title: `${schoolName} - Solicitud de activacion urgente`,
        description: [
          `Colegio: ${schoolName}`,
          `Alumno: ${normalizedStudentEmail}`,
          `Informador: ${user?.email ?? "-"}`,
          "Motivo: El alumno no aparece aun en Mochilas o su compra todavia no ha sido activada.",
          "Accion solicitada: Revision y activacion urgente del acceso.",
        ].join("\n"),
        priority: TicketPriority.urgente,
        category: "activacion_mochilas",
        customFields: {
          school: schoolName,
          studentEmail: normalizedStudentEmail,
          reporterEmail: user?.email ?? null,
          inquiryType: "Problemas de activación",
          mochilaLookup: null,
          activationRequested: true,
        },
        tenantId,
        schoolId,
      },
    });
  }

  function toggleLineAction(itemKey: string, action: StudentLineAction) {
    setSelectedLineActions((current) => {
      const activeActions = current[itemKey] ?? [];
      const nextActions = activeActions.includes(action)
        ? activeActions.filter((item) => item !== action)
        : [...activeActions, action];

      if (nextActions.length === 0) {
        const { [itemKey]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [itemKey]: nextActions,
      };
    });
  }

  function resetMochilasLookupState() {
    setMochilaLookup(null);
    setMochilaLookupError(null);
    setMochilaActivationSuggested(false);
    setSelectedLineActions({});
    setMochilaOrderId("");
  }

  function onSubmit(data: EducationTicketFormValues) {
    if (data.subjectType === "Docente" && !data.description?.trim()) {
      form.setError("description", {
        type: "manual",
        message: "Describe brevemente lo que le sucede al docente",
      });
      return;
    }

    if (data.subjectType === "SobreMiCuenta" && !data.description?.trim()) {
      form.setError("description", {
        type: "manual",
        message: "Describe brevemente lo que te sucede",
      });
      return;
    }

    if (subjectType === "Alumno" && shouldShowMochilasLookup) {
      const normalizedStudentEmail = data.studentEmail.trim().toLowerCase();
      if (!mochilaLookup || mochilaLookup.studentEmail !== normalizedStudentEmail) {
        toast({
          title: "Consulta Mochilas pendiente",
          description: "Busca primero el alumno por su correo para cargar los datos de Mochilas antes de crear el ticket.",
          variant: "destructive",
        });
        return;
      }
    }

    const schoolName = selectedSchool?.name || user?.schoolName || "Colegio";
    const tenantId =
      user?.scopeType === "global"
        ? data.tenantId!
        : (user?.tenantId as number);

    const schoolId =
      useSessionSchool
        ? (user?.schoolId as number)
        : (data.schoolId as number);

    const reporterEmail = hideReporterEmailField
      ? (user?.email ?? null)
      : (data.reporterEmail?.trim().toLowerCase() || null);

    const normalizedAffectedEmail =
      data.subjectType === "SobreMiCuenta"
        ? (user?.email ?? "").trim().toLowerCase()
        : data.studentEmail.trim().toLowerCase();
      const alumnoInquiryType = getAlumnoInquiryTypeFromActions(selectedActionItems);
      const inquiryTypeValue =
        data.subjectType === "Docente"
          ? "Docente Otras"
          : data.subjectType === "SobreMiCuenta"
          ? "Sobre su propia cuenta"
          : alumnoInquiryType;
      const title = inquiryTypeValue;
      const description = data.subjectType === "Docente"
        ? [
            `Colegio: ${schoolName}`,
          `Docente: ${normalizedAffectedEmail}`,
          reporterEmail ? `Informador: ${reporterEmail}` : null,
          "Consulta sobre: Docente",
          `Prioridad: ${data.priority ?? TicketPriority.media}`,
          `Descripción: ${data.description}`,
        ].filter(Boolean).join("\n")
      : data.subjectType === "SobreMiCuenta"
      ? [
          `Colegio: ${schoolName}`,
          `Usuario: ${normalizedAffectedEmail}`,
          reporterEmail ? `Informador: ${reporterEmail}` : null,
          "Consulta sobre: Sobre mi cuenta",
          `Prioridad: ${data.priority ?? TicketPriority.media}`,
          `Descripción: ${data.description}`,
        ].filter(Boolean).join("\n")
      : shouldUseSimplifiedAlumnoFlow
      ? [
          `Colegio: ${schoolName}`,
            `Alumno: ${normalizedAffectedEmail}`,
            reporterEmail ? `Informador: ${reporterEmail}` : null,
            "Consulta sobre: Alumno",
            selectedActionItems.length > 0
              ? `Acciones seleccionadas: ${selectedActionItems
                  .map((item) => `${item.description} (${item.actions.map((action) => (action === "return" ? "Devolucion" : "No ve el libro")).join(", ")})`)
                  .join(" | ")}`
              : `Motivo principal: ${alumnoInquiryType}`,
            data.observations?.trim() ? `Observaciones: ${data.observations.trim()}` : null,
          ].filter(Boolean).join("\n")
      : [
          `Colegio: ${schoolName}`,
          `${data.subjectType}: ${normalizedAffectedEmail}`,
          reporterEmail ? `Informador: ${reporterEmail}` : null,
          `Consulta sobre: ${data.subjectType}`,
          data.studentEnrollment ? `Matrícula: ${data.studentEnrollment}` : null,
          `Etapa: ${data.stage}`,
          `Curso: ${data.course}`,
          `Asignatura: ${data.subject}`,
          `Tipo de consulta: ${data.inquiryType}`,
          `Descripción: ${data.description}`,
          data.observations ? `Observaciones: ${data.observations}` : null,
        ].filter(Boolean).join("\n");

    createMutation.mutate({
      data: {
        title,
        description,
        priority: data.priority,
        category:
          data.subjectType === "Docente"
            ? "acceso_docente"
            : data.subjectType === "SobreMiCuenta"
            ? "acceso_cuenta_propia"
            : "consulta_educativa",
        customFields: {
          school: schoolName,
          studentEmail: data.subjectType === "Alumno" ? normalizedAffectedEmail : null,
          teacherEmail: data.subjectType === "Docente" ? normalizedAffectedEmail : null,
          affectedEmail: normalizedAffectedEmail,
          reporterEmail,
          subjectType: data.subjectType,
          studentEnrollment: data.studentEnrollment || null,
          stage: data.stage || null,
          course: data.course || null,
            subject: data.subject || null,
            inquiryType: inquiryTypeValue,
            observations: data.observations || null,
            mochilaLookup,
          lineActions: subjectType === "Alumno" && selectedActionItems.length > 0 ? selectedActionItems : null,
          returnItems: subjectType === "Alumno" && selectedReturnItems.length > 0 ? selectedReturnItems : null,
          returnRequested: subjectType === "Alumno" && selectedReturnItems.length > 0,
        },
        tenantId,
        schoolId,
      },
    });
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Button variant="ghost" onClick={() => setLocation("/tickets")} className="gap-2 -ml-4 text-slate-500">
        <ArrowLeft className="h-4 w-4" />
        Volver a Tickets
      </Button>

      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Nueva consulta educativa</h1>
        <p className="text-slate-500 mt-1">Registra una consulta de forma guiada para que el equipo técnico pueda atenderla con rapidez.</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Card>
            <CardHeader>
              <CardTitle>Datos de la consulta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {(user?.role === "superadmin" || user?.role === "tecnico") && (
                <FormField
                  control={form.control}
                  name="tenantId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Red educativa *</FormLabel>
                      <Select onValueChange={(v) => {
                        field.onChange(parseInt(v, 10));
                        form.setValue("schoolId", undefined);
                        setMochilaLookup(null);
                        setMochilaLookupError(null);
                      }} defaultValue={field.value?.toString()}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona una red educativa" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {tenants?.data.map((tenant) => (
                            <SelectItem key={tenant.id} value={tenant.id.toString()}>{tenant.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {!useSessionSchool && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="schoolId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Colegio *</FormLabel>
                        <Select
                          onValueChange={(v) => field.onChange(parseInt(v, 10))}
                          value={field.value?.toString()}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecciona un colegio" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {tenantSchools.map((school) => (
                              <SelectItem key={school.id} value={school.id.toString()}>{school.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {!hideReporterEmailField && (
                    <FormField
                      control={form.control}
                      name="reporterEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Correo de contacto</FormLabel>
                          <FormControl>
                            <Input placeholder="Opcional: correo del docente o del informador" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}

              {useSessionSchool && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Colegio activo</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{user?.schoolName || user?.tenantName || "Colegio asignado"}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cuenta que registra la consulta</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{user?.email || "-"}</p>
                    </div>
                  </div>
                </div>
              )}

              <FormField
                control={form.control}
                name="subjectType"
                render={({ field }) => (
                  <FormItem className="w-full md:w-[20rem]">
                    <FormLabel>La consulta es sobre *</FormLabel>
                    <Select
                      onValueChange={(value) => {
                            field.onChange(value);
                            form.setValue("studentEmail", value === "SobreMiCuenta" ? (user?.email ?? "") : "");
                            setMochilaLookup(null);
                            setMochilaLookupError(null);
                            setMochilaActivationSuggested(false);
                            setMochilaLookupMode("email");
                            setMochilaOrderId("");
                            setShowTeacherRegistrationRequest(false);
                          }}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecciona una opción" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Alumno">Alumno</SelectItem>
                        {supportsTeacherSubject && <SelectItem value="Docente">Docente</SelectItem>}
                        <SelectItem value="SobreMiCuenta">Sobre mi cuenta</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {subjectType === "SobreMiCuenta" && (
                <div className="space-y-5 rounded-[28px] border border-violet-200 bg-gradient-to-br from-[#ffffff] via-[#faf7ff] to-[#f2eeff] p-5 shadow-[0_20px_60px_rgba(79,70,229,0.10)]">
                  <div>
                    <h3 className="text-xl font-bold tracking-tight text-slate-950">Consulta sobre mi cuenta</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Indica la prioridad y describe lo que te sucede para enviar la consulta.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sobre mi cuenta</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{user?.email || "-"}</p>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[12rem_1fr]">
                    <FormField
                      control={form.control}
                      name="priority"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Prioridad</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecciona prioridad" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value={TicketPriority.baja}>Baja</SelectItem>
                              <SelectItem value={TicketPriority.media}>Media</SelectItem>
                              <SelectItem value={TicketPriority.alta}>Alta</SelectItem>
                              <SelectItem value={TicketPriority.urgente}>Urgente</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-sm font-semibold text-slate-900">Tu consulta se tratará con confidencialidad</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Describe brevemente el problema y el equipo técnico lo revisará contigo.
                      </p>
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Descripción / observaciones *</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Describe brevemente el problema de acceso o lo que necesitas revisar..."
                            className="min-h-[140px] resize-y rounded-2xl border-slate-200 bg-white"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {subjectType === "Docente" && (
                <div className="space-y-5 rounded-[28px] border border-violet-200 bg-gradient-to-br from-[#ffffff] via-[#faf7ff] to-[#f2eeff] p-5 shadow-[0_20px_60px_rgba(79,70,229,0.10)]">
                  <div>
                    <h3 className="text-xl font-bold tracking-tight text-slate-950">Consulta sobre docente</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Indica el correo del docente, la prioridad y una breve descripción para enviar la solicitud.
                    </p>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[minmax(16rem,1fr)_12rem]">
                    <FormField
                      control={form.control}
                      name="studentEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email del docente *</FormLabel>
                          <FormControl>
                            <Input placeholder="docente@centro.es" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="priority"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Prioridad</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecciona prioridad" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value={TicketPriority.baja}>Baja</SelectItem>
                              <SelectItem value={TicketPriority.media}>Media</SelectItem>
                              <SelectItem value={TicketPriority.alta}>Alta</SelectItem>
                              <SelectItem value={TicketPriority.urgente}>Urgente</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      className="h-11 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-5 text-white shadow-[0_12px_24px_rgba(99,102,241,0.24)] hover:from-violet-700 hover:to-indigo-700"
                      onClick={() => createTeacherDirectTicket("access")}
                      disabled={quickAccessIssueMutation.isPending}
                    >
                      No puede acceder
                    </Button>
                    <Button
                      type="button"
                      className="h-11 rounded-full bg-gradient-to-r from-emerald-500 to-green-600 px-5 text-white shadow-[0_12px_24px_rgba(34,197,94,0.24)] hover:from-emerald-600 hover:to-green-700"
                      onClick={() => createTeacherDirectTicket("registration")}
                      disabled={quickAccessIssueMutation.isPending}
                    >
                      Solicitar alta
                    </Button>
                  </div>

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            placeholder="Describe brevemente el problema de acceso del docente..."
                            className="min-h-[120px] resize-y rounded-2xl border-slate-200 bg-white"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_22px_rgba(15,23,42,0.06)]">
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                          <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Seguro</p>
                          <p className="mt-1 text-xs leading-6 text-slate-500">Tus datos están protegidos y solo son visibles para personal autorizado.</p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_22px_rgba(15,23,42,0.06)]">
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                          <Clock3 className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Rápido</p>
                          <p className="mt-1 text-xs leading-6 text-slate-500">Encuentra la información que necesitas en segundos, sin complicaciones.</p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_22px_rgba(15,23,42,0.06)]">
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                          <Users className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Soporte</p>
                          <p className="mt-1 text-xs leading-6 text-slate-500">Si tienes dudas, nuestro equipo está aquí para ayudarte.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {shouldShowMochilasLookup && (
                <div
                  className={
                    mochilaLookup
                      ? "space-y-6"
                      : "space-y-6 rounded-[32px] border border-violet-200/80 bg-gradient-to-br from-[#ffffff] via-[#faf7ff] to-[#f2eeff] p-6 shadow-[0_28px_80px_rgba(79,70,229,0.14)]"
                  }
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[28px] border border-violet-200 bg-gradient-to-br from-[#ece7ff] to-[#d7ceff] shadow-[0_14px_30px_rgba(99,102,241,0.18)]">
                      <Backpack className="h-10 w-10 text-violet-700" />
                    </div>
                    <div>
                      <h3 className="text-5xl font-bold tracking-tight text-slate-950">Búsqueda de Mochilas</h3>
                        <p className="mt-2 max-w-2xl text-base leading-7 text-slate-600">
                          Consulta datos de acceso y libros activados usando el correo del alumno o el pedido.
                        </p>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-violet-200 bg-white/95 p-5 shadow-[0_12px_30px_rgba(99,102,241,0.08)]">
                  {(mochilasEnabled || useSessionSchool) && (
                    <div className="grid gap-5 xl:grid-cols-[1fr_1px_0.92fr] xl:items-end">
                      <FormField
                        control={form.control}
                        name="studentEmail"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <div className="flex items-center gap-2">
                              <FormLabel className="m-0 text-base font-semibold text-slate-900">Email del alumno</FormLabel>
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                                <Mail className="h-4 w-4" />
                              </span>
                              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500">
                                <HelpCircle className="h-4 w-4" />
                              </span>
                            </div>
                            <div className="grid gap-3 md:grid-cols-[minmax(18rem,1fr)_auto]">
                              <FormControl>
                                <Input
                                  placeholder="alumno@centro.es"
                                  className="h-12 rounded-2xl border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"
                                  autoComplete="off"
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      void lookupStudentInMochilas();
                                    }
                                  }}
                                  {...field}
                                />
                              </FormControl>
                              <Button
                                type="button"
                                className="h-12 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 text-white shadow-[0_12px_24px_rgba(99,102,241,0.28)] hover:from-violet-700 hover:to-indigo-700"
                                onClick={lookupStudentInMochilas}
                                disabled={isLookingUpMochila || !(selectedTenantId || user?.tenantId)}
                              >
                                <Search className="mr-2 h-4 w-4" />
                                {isLookingUpMochila ? "Buscando..." : "Buscar en mochilas"}
                              </Button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="hidden bg-violet-100 xl:block" />
                    </div>
                  )}

                  {orderLookupEnabled && (
                    <div className="grid gap-3 md:grid-cols-[minmax(10rem,12rem)_auto] md:items-end">
                      <div className="w-full max-w-[12rem] space-y-2">
                        <label className="text-sm font-medium leading-none" style={{ color: tenantPanelText }}>
                          Pedido *
                        </label>
                        <Input
                          placeholder="Ej. 2068466760"
                          className="font-normal text-slate-900 placeholder:font-normal placeholder:!text-slate-400"
                          style={panelInputStyle}
                          autoComplete="off"
                          value={mochilaOrderId}
                          onChange={(event) => setMochilaOrderId(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void lookupStudentByOrderInMochilas();
                            }
                          }}
                        />
                      </div>

                      <div className="flex items-end">
                        <Button
                          type="button"
                          className="w-full md:w-auto"
                          onClick={lookupStudentByOrderInMochilas}
                          disabled={isLookingUpMochila || !(selectedTenantId || user?.tenantId)}
                        >
                          {isLookingUpMochila ? "Buscando..." : "Buscar por pedido"}
                        </Button>
                      </div>
                    </div>
                  )}
                  </div>

                  {mochilaLookupError && (
                    <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      <p>{mochilaLookupError}</p>
                      {mochilaActivationSuggested && (
                        <Button type="button" onClick={createUrgentActivationTicket} disabled={createMutation.isPending}>
                          {createMutation.isPending ? "Creando solicitud..." : "Solicitar activacion urgente"}
                        </Button>
                      )}
                    </div>
                  )}

                  {mochilaLookup && (
                    <div id="mochila-result-card" className="space-y-5 rounded-[28px] border border-violet-200 bg-white p-5 shadow-[0_20px_60px_rgba(79,70,229,0.10)]">
                      <div className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
                        <div className="overflow-hidden rounded-[24px] border border-violet-100 bg-white shadow-[0_12px_30px_rgba(99,102,241,0.08)]">
                            <div className="border-b border-violet-100 p-5">
                              <div className="flex flex-col items-start gap-4">
                                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#cec7ff] to-[#7e6cff] text-4xl font-semibold text-white shadow-[0_16px_34px_rgba(124,108,255,0.28)]">
                                  {getInitials(mochilaLookup.studentName, mochilaLookup.studentSurname, mochilaLookup.studentEmail)}
                                </div>
                                <div className="min-w-0">
                                  <span className="inline-flex rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-violet-700">
                                    Alumno
                                  </span>
                                  <p className="mt-3 max-w-[13rem] text-[1.55rem] font-bold leading-[1.08] tracking-[-0.02em] text-slate-950">
                                    {[mochilaLookup.studentName, mochilaLookup.studentSurname].filter(Boolean).join(" ") || "Sin nombre"}
                                  </p>
                                </div>
                              </div>
                            </div>
                          <div className="p-5">
                            <p className="text-sm font-semibold text-slate-700">Colegio</p>
                            <div className="mt-3 space-y-3">
                              {mochilaLookup.schools.map((school) => (
                                <div key={school} className="rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-[#f8f5ff] p-4">
                                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Colegio</p>
                                  <div className="mt-2 flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
                                      <Building2 className="h-10 w-5" />
                                    </div>
                                    <p className="text-base font-semibold leading-tight text-slate-900">{school}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-3 rounded-[24px] border border-violet-100 bg-white p-5 shadow-[0_12px_30px_rgba(99,102,241,0.08)]">
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                                <KeyRound className="h-5 w-5" />
                              </div>
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Credenciales</p>
                                <p className="text-sm text-slate-500">Datos de acceso detectados</p>
                              </div>
                            </div>
                            <Button type="button" size="sm" variant="outline" className="rounded-2xl border-slate-300 bg-white" onClick={openChangeStudentEmailDialog}>
                              <Mail className="mr-2 h-4 w-4" />
                              Cambiar email
                            </Button>
                          </div>

                          <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                            <div className="space-y-2">
                              <div>
                                <p className="text-sm text-slate-500">Email del alumno</p>
                                <p className="text-base font-semibold text-slate-900">{mochilaLookup.studentEmail || "-"}</p>
                              </div>
                              <div>
                                <p className="text-sm text-slate-500">Usuario</p>
                                <div className="mt-1 flex items-center gap-1">
                                  <p className="text-base font-semibold text-slate-900">
                                    {mochilaLookup.studentUser || "-"}
                                  </p>
                                  <button
                                    type="button"
                                    className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                                    onClick={async () => {
                                      if (!mochilaLookup.studentUser) return;
                                      await navigator.clipboard.writeText(mochilaLookup.studentUser);
                                      toast({ title: "Usuario copiado", description: "Se ha copiado el usuario del alumno." });
                                    }}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div>
                              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-600">
                                <CheckCircle2 className="h-4 w-4" />
                                Verificado
                              </div>
                            </div>
                          </div>

                          <div className="rounded-[24px] border border-amber-300 bg-gradient-to-br from-[#fffaf0] to-[#fff2dd] p-4 shadow-[0_12px_30px_rgba(251,191,36,0.12)]">
                            <div className="flex items-start gap-3">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-200/70 text-amber-700">
                                <KeyRound className="h-6 w-6" />
                              </div>
                              <div>
                                <p className="text-lg font-bold tracking-tight text-slate-950 sm:text-[0.90rem]">¿Intenta recuperar la contraseña del alumno?</p>
                                  <p className="mt-1 text-sm leading-7 text-slate-600">
                                    Desde aquí puedes intentar recuperar sus contraseñas a las plataformas.
                                  </p>
                              </div>
                            </div>

                            <div className="mt-4 space-y-3">
                              {studentEnglishCredential && (
                                <div className="rounded-2xl border border-amber-200 bg-white px-4 py-4 shadow-sm">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex items-start gap-3">
                                      <LanguageFlag kind="english" />
                                      <div>
                                        <p className="text-sm font-semibold text-slate-900">Inglés</p>
                                        <p className="mt-1 text-sm text-slate-600">{studentEnglishCredential.password || "-"}</p>
                                      </div>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="h-10 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-5 text-sm text-white hover:from-amber-600 hover:to-orange-600"
                                      onClick={handleForgotStudentEnglishPassword}
                                    >
                                      Cambiar contraseña
                                    </Button>
                                  </div>
                                </div>
                              )}

                              {studentBlinkCredential && (
                                <div className="rounded-2xl border border-amber-200 bg-white px-4 py-4 shadow-sm">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex items-start gap-3">
                                      <LanguageFlag kind="frde" />
                                      <div>
                                        <p className="text-sm font-semibold text-slate-900">Francés/alemán</p>
                                        <p className="mt-1 text-sm text-slate-600">{studentBlinkCredential.password || "-"}</p>
                                      </div>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="h-10 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-5 text-sm text-white hover:from-amber-600 hover:to-orange-600"
                                      onClick={handleForgotStudentBlinkPassword}
                                    >
                                      Cambiar contraseña
                                    </Button>
                                  </div>
                                </div>
                              )}

                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-violet-200 bg-gradient-to-r from-[#f4efff] to-[#f7f5ff] px-5 py-4 shadow-[0_10px_30px_rgba(99,102,241,0.08)]">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-white shadow-[0_12px_28px_rgba(99,102,241,0.28)]">
                              <Users className="h-6 w-6" />
                            </div>
                            <div>
                              <p className="text-2xl font-bold tracking-tight text-slate-950">¿Aún continúas sin poder acceder?</p>
                              <p className="text-sm text-slate-600">Nuestro equipo de soporte puede ayudarte.</p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            className="rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 text-white shadow-[0_12px_24px_rgba(99,102,241,0.25)] hover:from-violet-700 hover:to-indigo-700"
                            onClick={createAccessIssueTicket}
                            disabled={quickAccessIssueMutation.isPending}
                          >
                            {quickAccessIssueMutation.isPending ? "Creando consulta..." : "Contactar soporte"}
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
                            <Building2 className="h-5 w-5" />
                          </div>
                          <p className="text-3xl font-bold tracking-tight text-slate-950">Libros activos</p>
                        </div>
                        <div className="overflow-hidden rounded-[24px] border border-violet-200 bg-white shadow-[0_14px_34px_rgba(99,102,241,0.08)]">
                          <table className="w-full text-sm">
                            <thead className="bg-[#f3efff] text-left text-[11px] uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-4 py-3 font-semibold">Descripción</th>
                                <th className="px-4 py-3 font-semibold">ISBN</th>
                                <th className="px-4 py-3 font-semibold">Pedido</th>
                                <th className="px-4 py-3 font-semibold">Goog</th>
                                <th className="px-4 py-3 font-semibold">Código de libro</th>
                                <th className="px-4 py-3 font-semibold text-right">Acciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summarizedMochilaRecords.map((record) => {
                                const activeActions = selectedLineActions[record.key] ?? [];
                                const isSelectedForReturn = activeActions.includes("return");
                                const isSelectedMissingBook = activeActions.includes("missing_book");
                                const hasSelectedActions = activeActions.length > 0;

                                return (
                                  <tr
                                    key={record.key}
                                    className={`border-t border-violet-100 align-top ${hasSelectedActions ? "bg-amber-50/70" : "bg-white"}`}
                                  >
                                    <td className="px-4 py-4 text-slate-900">{record.description}</td>
                                    <td className="px-4 py-4 text-slate-900">{record.isbn}</td>
                                    <td className="px-4 py-4 text-slate-900">{record.orderId}</td>
                                    <td className="px-4 py-4 text-slate-900">{record.google}</td>
                                    <td className="whitespace-nowrap px-4 py-4 text-slate-900">{record.bookCode}</td>
                                    <td className="px-4 py-4 text-right">
                                      <div className="flex justify-end gap-2">
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant={isSelectedMissingBook ? "default" : "outline"}
                                          className={isSelectedMissingBook ? "h-10 w-10 rounded-xl bg-violet-600 text-white hover:bg-violet-700" : "h-10 w-10 rounded-xl border-violet-200 text-violet-600 hover:bg-violet-50"}
                                          onClick={() => toggleLineAction(record.key, "missing_book")}
                                          title="No ve el libro"
                                          aria-label="No ve el libro"
                                        >
                                          <BookX className="h-4 w-4" />
                                        </Button>
                                        {returnsEnabled && (
                                          <Button
                                            type="button"
                                            size="icon"
                                            variant={isSelectedForReturn ? "default" : "outline"}
                                            className={isSelectedForReturn ? "h-10 w-10 rounded-xl bg-violet-600 text-white hover:bg-violet-700" : "h-10 w-10 rounded-xl border-violet-200 text-violet-600 hover:bg-violet-50"}
                                            onClick={() => toggleLineAction(record.key, "return")}
                                            title="Devolución"
                                            aria-label="Devolución"
                                          >
                                            <Undo2 className="h-4 w-4" />
                                          </Button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          <div className="flex flex-col gap-3 border-t border-violet-100 bg-[#faf8ff] px-4 py-3 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
                            <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-sm">
                              <Copy className="h-4 w-4 text-violet-500" />
                              Mostrando {summarizedMochilaRecords.length} libro(s)
                            </div>
                            <div className="flex items-center gap-2">
                              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-200 bg-white text-slate-400">
                                ‹
                              </button>
                              <button type="button" className="flex h-8 min-w-8 items-center justify-center rounded-lg border border-violet-300 bg-violet-100 px-2 font-semibold text-violet-700">
                                1
                              </button>
                              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-200 bg-white text-slate-400">
                                ›
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                              <ShieldCheck className="h-6 w-6" />
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900">Seguro</p>
                              <p className="text-sm text-slate-500">Tus datos están protegidos y solo son visibles para personal autorizado.</p>
                            </div>
                          </div>
                        </div>
                        <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                              <Clock3 className="h-6 w-6" />
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900">Rápido</p>
                              <p className="text-sm text-slate-500">Encuentra la información que necesitas en segundos, sin complicaciones.</p>
                            </div>
                          </div>
                        </div>
                        <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                              <Users className="h-6 w-6" />
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900">Soporte</p>
                              <p className="text-sm text-slate-500">Si tienes dudas, nuestro equipo está aquí para ayudarte.</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      {selectedActionItems.length > 0 && (
                        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
                          Se guardarán {selectedActionItems.length} línea(s) con acciones marcadas en esta consulta.
                        </div>
                      )}
                      {returnsEnabled && selectedReturnItems.length > 0 && (
                        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
                          Se guardarán {selectedReturnItems.length} línea(s) marcadas para devolución al crear el ticket.
                        </div>
                      )}
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <FormField
                          control={form.control}
                          name="observations"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Descripción / observaciones adicionales</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Si quieres, añade algún detalle adicional para el equipo técnico..."
                                  className="min-h-[120px] resize-y bg-white"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {subjectType === "Alumno" && !shouldShowMochilasLookup && (
                <FormField
                  control={form.control}
                  name="studentEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email del alumno *</FormLabel>
                      <FormControl>
                        <Input placeholder="correo@micolegio.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {shouldShowTeacherTicketFields && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="subjectType"
                    render={({ field }) => (
                      <FormItem className="hidden">
                        <FormLabel>La consulta es sobre *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecciona una opción" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Alumno">Alumno</SelectItem>
                            {supportsTeacherSubject && <SelectItem value="Docente">Docente</SelectItem>}
                            <SelectItem value="SobreMiCuenta">Sobre mi cuenta</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {!shouldHideExtendedFields && (
                <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="subjectType"
                  render={({ field }) => (
                    <FormItem className="hidden">
                      <FormLabel>La consulta es sobre *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona una opción" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Alumno">Alumno</SelectItem>
                          {supportsTeacherSubject && <SelectItem value="Docente">Docente</SelectItem>}
                          <SelectItem value="SobreMiCuenta">Sobre mi cuenta</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prioridad</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona prioridad" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={TicketPriority.baja}>Baja</SelectItem>
                          <SelectItem value={TicketPriority.media}>Media</SelectItem>
                          <SelectItem value={TicketPriority.alta}>Alta</SelectItem>
                          <SelectItem value={TicketPriority.urgente}>Urgente</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField
                  control={form.control}
                  name="studentEnrollment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Matrícula alumno</FormLabel>
                      <FormControl>
                        <Input placeholder="Ej. 2153" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="stage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Etapa *</FormLabel>
                      <FormControl>
                        <Input placeholder="Primaria, Secundaria..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="course"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Curso *</FormLabel>
                      <FormControl>
                        <Input placeholder="Ej. 2Âº ESO" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Asignatura *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona asignatura" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Inglés">Inglés</SelectItem>
                          <SelectItem value="Alemán">Alemán</SelectItem>
                          <SelectItem value="Francés">Francés</SelectItem>
                          <SelectItem value="Todas">Todas</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="inquiryType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de consulta *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona el tipo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Alumno sin libros">Alumno sin libros</SelectItem>
                          <SelectItem value="No puede acceder">No puede acceder</SelectItem>
                          <SelectItem value="Problemas de activación">Problemas de activación</SelectItem>
                          <SelectItem value="No funciona el libro">No funciona el libro</SelectItem>
                          <SelectItem value="Otro">Otro</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción de la consulta/incidencia *</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Cuéntanos qué ocurre, en qué plataforma y cómo reproducirlo..."
                        className="min-h-[160px] resize-y"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="observations"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Observaciones</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Detalles adicionales, contexto pedagógico o notas para el equipo técnico..."
                        className="min-h-[120px] resize-y"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                  )}
                />
                </>
              )}
            </CardContent>
            <CardFooter className="bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-3 px-6 py-4 rounded-b-xl border-t">
              <Button type="button" variant="outline" onClick={() => setLocation("/tickets")}>
                Cancelar
              </Button>
                {canSubmitForm && subjectType !== "Docente" && (
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {subjectType === "Docente" ? "Enviar solicitud" : "Enviar consulta"}
                </Button>
              )}
            </CardFooter>
          </Card>
        </form>
      </Form>

      <Dialog open={showChangeEmailDialog} onOpenChange={setShowChangeEmailDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cambiar email del alumno</DialogTitle>
            <DialogDescription>Revisa el correo actual y escribe el email correcto para enviar la solicitud.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Email actual en BBDD</p>
              <div className="rounded-lg border bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {(mochilaLookup?.studentEmail || form.getValues("studentEmail")).trim().toLowerCase() || "-"}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="requested-student-email">
                Email correcto
              </label>
              <Input
                id="requested-student-email"
                type="email"
                placeholder="alumno@centro.es"
                value={requestedStudentEmail}
                onChange={(event) => {
                  setRequestedStudentEmail(event.target.value);
                  if (requestedStudentEmailError) setRequestedStudentEmailError(null);
                }}
              />
              {requestedStudentEmailError && <p className="text-sm text-rose-600">{requestedStudentEmailError}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowChangeEmailDialog(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleChangeStudentEmail}>
              Enviar solicitud
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
