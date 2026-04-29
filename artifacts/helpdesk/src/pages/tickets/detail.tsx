import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  customFetch,
  useGetTicket,
  useListTicketComments,
  useAddTicketComment,
  useChangeTicketStatus,
  useGetMe,
  useUpdateTicket,
  TicketStatus,
  TicketPriority,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Send, Clock, User, Building, Paperclip, Lock, LockOpen, Pencil, XCircle, ExternalLink, KeyRound, Backpack, Copy } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { StatusBadge, PriorityBadge } from "@/components/badges";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";

function readField(ticket: any, key: string) {
  return ticket?.customFields && key in ticket.customFields ? ticket.customFields[key] : null;
}

function fixMojibake(value: string) {
  let next = value;

  if (/[ÃƒÃ‚Ã¢]/.test(next)) {
    try {
      next = new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(next, (char) => char.charCodeAt(0) & 0xff)) || next;
    } catch {
      next = value;
    }
  }

  const replacements: Array<[RegExp, string]> = [
    [/activaci\?n/gi, "activación"],
    [/informaci\?n/gi, "información"],
    [/resoluci\?n/gi, "resolución"],
    [/educaci\?n/gi, "educación"],
    [/aplicaci\?n/gi, "aplicación"],
    [/descripci\?n/gi, "descripción"],
    [/asignaci\?n/gi, "asignación"],
    [/gesti\?n/gi, "gestión"],
    [/sesi\?n/gi, "sesión"],
    [/versi\?n/gi, "versión"],
    [/revisi\?n/gi, "revisión"],
    [/categori\?a/gi, "categoría"],
    [/matr[i?]cula/gi, "matrícula"],
    [/contrase\?a/gi, "contraseña"],
    [/espa\?ol/gi, "español"],
    [/atenci\?n/gi, "atención"],
    [/soluci\?n/gi, "solución"],
    [/IntÃ©ntalo/gi, "Inténtalo"],
    [/DescripciÃ³n/gi, "Descripción"],
    [/CategorÃ­a/gi, "Categoría"],
    [/categorÃ­a/gi, "categoría"],
    [/RevisiÃ³n/gi, "Revisión"],
    [/revisiÃ³n/gi, "revisión"],
    [/devoluciÃ³n/gi, "devolución"],
    [/verÃ¡n/gi, "verán"],
    [/Ã¡/g, "á"],
    [/Ã©/g, "é"],
    [/Ã­/g, "í"],
    [/Ã³/g, "ó"],
    [/Ãº/g, "ú"],
    [/Ã±/g, "ñ"],
    [/ÃƒÂ¡/g, "á"],
    [/ÃƒÂ©/g, "é"],
    [/ÃƒÂ­/g, "í"],
    [/ÃƒÂ³/g, "ó"],
    [/ÃƒÂº/g, "ú"],
    [/ÃƒÂ±/g, "ñ"],
    [/Ã‚Âº/g, "º"],
    [/Ã‚Â·/g, "·"],
  ];

  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), next);
}

function safeDisplayText(value: unknown) {
  if (value === null || value === undefined) return "";
  return fixMojibake(String(value));
}

function getMochilaRecords(ticket: any) {
  const records = ticket?.customFields?.mochilaLookup?.records;
  return Array.isArray(records) ? records : [];
}

function getTicketOrderId(ticket: any) {
  const explicitOrderId = ticket?.customFields?.orderId;
  if (explicitOrderId !== undefined && explicitOrderId !== null) {
    return safeDisplayText(explicitOrderId);
  }

  const recordWithOrder = getMochilaRecords(ticket).find((record: any) => record?.idOrder !== undefined && record?.idOrder !== null);
  return safeDisplayText(recordWithOrder?.idOrder ?? "");
}

function getTicketStudentEmail(ticket: any) {
  return safeDisplayText(
    ticket?.customFields?.currentStudentEmail ??
      ticket?.customFields?.studentEmail ??
      ticket?.customFields?.affectedEmail ??
      ticket?.customFields?.mochilaLookup?.studentEmail ??
      ""
  ).trim().toLowerCase();
}

function getTicketPasswordToken(ticket: any) {
  const explicitToken = ticket?.customFields?.token;
  if (explicitToken !== undefined && explicitToken !== null) {
    return safeDisplayText(explicitToken).trim();
  }

  const recordWithToken = getMochilaRecords(ticket).find((record: any) => safeDisplayText(record?.token).trim() !== "");
  return safeDisplayText(recordWithToken?.token ?? "").trim();
}

function formatTicketFieldLabel(key: string) {
  const labels: Record<string, string> = {
    studentEmail: "Email del alumno",
    reporterEmail: "Cuenta que registra la consulta",
    inquiryType: "Tipo de consulta",
    subjectType: "La consulta es sobre",
    stage: "Etapa",
    course: "Curso",
    studentEnrollment: "Matrícula del alumno",
    subject: "Asignatura",
    observations: "Observaciones",
    activationRequested: "Activación urgente",
    returnRequested: "Devolución solicitada",
    currentStudentEmail: "Correo actual",
    newStudentEmail: "Correo nuevo",
    affectedEmail: "Correo afectado",
    orderId: "Pedido",
    importedSchool: "Colegio importado",
    importedTenantName: "Red educativa importada",
    changeEmailRequested: "Cambio de correo solicitado",
  };

  return labels[key] ?? key;
}

function formatAuditAction(action: unknown) {
  const actions: Record<string, string> = {
    create: "creó la consulta",
    update: "actualizó la consulta",
    assign: "asignó la consulta",
    status_change: "cambió el estado",
    bulk_import: "importó la consulta",
  };

  return actions[String(action ?? "")] ?? safeDisplayText(action);
}

function isLoginAccessTicket(ticket: any) {
  const source = safeDisplayText(ticket?.customFields?.source).trim();
  return (
    ticket?.category === "recuperacion_contrasena_login" ||
    ticket?.category === "contacto_soporte_login" ||
    source === "forgot_password" ||
    source === "login_support_contact" ||
    source === "contact_support"
  );
}

export default function TicketDetail() {
  const [location, setLocation] = useLocation();
  const id = useMemo(() => {
    const pathname = location.split("?")[0] ?? "";
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] ?? "";
    const parsed = Number(lastSegment);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [location]);
  
  const { data: user } = useGetMe();
  const { data: ticket, isLoading: ticketLoading, error: ticketError, refetch: refetchTicket } = useGetTicket(id);
  const { data: comments, refetch: refetchComments } = useListTicketComments(id);
  
  const [commentText, setCommentText] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editPriority, setEditPriority] = useState<TicketPriority>(TicketPriority.media);
  const [editStudentEmail, setEditStudentEmail] = useState("");
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [validatedUserResetOpen, setValidatedUserResetOpen] = useState(false);
  const [isResettingValidatedUser, setIsResettingValidatedUser] = useState(false);
  const [orderLookup, setOrderLookup] = useState<any | null>(null);
  const [isLoadingOrder, setIsLoadingOrder] = useState(false);

  const addComment = useAddTicketComment({
    mutation: {
      onSuccess: async () => {
        setCommentText("");
        await Promise.all([refetchComments(), refetchTicket()]);
      }
    }
  });

  const changeStatus = useChangeTicketStatus({
    mutation: {
      onSuccess: async () => {
        await refetchTicket();
      },
      onError: (error) => {
        toast({
          title: "No se pudo actualizar el estado",
          description: error instanceof Error ? safeDisplayText(error.message) : "Inténtalo de nuevo.",
          variant: "destructive",
        });
      },
    }
  });

  const updateTicket = useUpdateTicket({
    mutation: {
      onSuccess: async () => {
        setEditOpen(false);
        toast({
          title: "Consulta actualizada",
          description: "Los cambios se han guardado correctamente.",
        });
        await refetchTicket();
      },
      onError: (error) => {
        toast({
          title: "No se pudo actualizar la consulta",
          description: error instanceof Error ? safeDisplayText(error.message) : "Inténtalo de nuevo.",
          variant: "destructive",
        });
      },
    },
  });

  const isStaff = ["superadmin", "tecnico", "admin_cliente"].includes(user?.role ?? "");
  const canUseMeeAdmin = ["superadmin", "tecnico"].includes(user?.role ?? "");
  const canResetValidatedUserPassword = ["superadmin", "tecnico"].includes(user?.role ?? "");
  const canManageTicket = !!user && !!ticket && (isStaff || ticket.createdById === user.id);
  const showInlineManageButtons = canManageTicket && user?.role !== "tecnico";
  const isAccessRequestTicket = isLoginAccessTicket(ticket);
  const meeAdminEmail = getTicketStudentEmail(ticket);
  const meeAdminToken = getTicketPasswordToken(ticket);
  const ticketOrderId = getTicketOrderId(ticket).trim();
  const requesterEmail = safeDisplayText(ticket?.customFields?.requesterEmail).trim().toLowerCase();
  const requesterName = safeDisplayText(ticket?.customFields?.requesterName).trim();
  const requesterPhone = safeDisplayText(ticket?.customFields?.requesterPhone).trim();
  const requesterSchoolName = safeDisplayText(ticket?.customFields?.requesterSchoolName).trim();
  const accessSource = safeDisplayText(ticket?.customFields?.source).trim();
  const mochilaRecords = useMemo(() => getMochilaRecords(ticket), [ticket]);
  const incidentData = useMemo(() => {
    if (!ticket?.customFields) return [];

    const orderedKeys = [
      "studentEmail",
      "reporterEmail",
      "orderId",
      "inquiryType",
      "subjectType",
      "studentEnrollment",
      "stage",
      "course",
      "subject",
      "observations",
      "activationRequested",
    ];

    return orderedKeys.flatMap((key) => {
      const value = key === "orderId" ? getTicketOrderId(ticket) : ticket.customFields[key];
      const shouldShow = key === "orderId"
        ? canUseMeeAdmin
        : value !== undefined && value !== null && String(value).trim() !== "";

      return shouldShow ? [{
        key,
        label: formatTicketFieldLabel(key),
        value,
      }] : [];
    });
  }, [ticket, canUseMeeAdmin]);

  const extraCustomFields = useMemo(() => {
    if (!ticket?.customFields) return [];

    const hidden = new Set([
      "studentEmail",
      "reporterEmail",
      "requesterEmail",
      "requesterName",
      "requesterPhone",
      "requesterSchoolName",
      "source",
      "submittedAt",
      "inquiryType",
      "subjectType",
      "studentEnrollment",
      "stage",
      "course",
      "subject",
      "observations",
      "activationRequested",
      "orderId",
      "returnRequested",
      "returnItems",
      "lineActions",
      "mochilaLookup",
      "school",
    ]);

    return Object.entries(ticket.customFields).filter(([key, value]) => !hidden.has(key) && value !== null && value !== undefined && String(value).trim() !== "");
  }, [ticket]);
  const returnItems = useMemo(() => {
    const raw = ticket?.customFields?.returnItems;
    return Array.isArray(raw) ? raw : [];
  }, [ticket]);
  const lineActions = useMemo(() => {
    const raw = ticket?.customFields?.lineActions;
    return Array.isArray(raw) ? raw : [];
  }, [ticket]);
  const actionItems = useMemo(() => {
    if (lineActions.length > 0) return lineActions;
    return returnItems;
  }, [lineActions, returnItems]);
  const orderRecords = useMemo(() => {
    const records = orderLookup?.records;
    return Array.isArray(records) ? records : [];
  }, [orderLookup]);
  const orderRecord = useMemo(() => {
    return orderRecords.find((record: any) => safeDisplayText(record?.idOrder).trim() === ticketOrderId) ?? orderRecords[0] ?? null;
  }, [orderRecords, ticketOrderId]);

  if (ticketLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto animate-pulse">
        <div className="h-8 w-32 bg-slate-200 rounded" />
        <div className="h-32 bg-slate-200 rounded-xl" />
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 h-96 bg-slate-200 rounded-xl" />
          <div className="h-64 bg-slate-200 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!id) {
    return <div>Ticket no encontrado</div>;
  }

  if (ticketError && !ticket) {
    const errorMessage = ticketError instanceof Error ? ticketError.message : "Inténtalo de nuevo desde la bandeja.";
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Button variant="ghost" onClick={() => setLocation("/tickets")} className="gap-2 -ml-4 text-slate-500">
          <ArrowLeft className="h-4 w-4" />
          Volver a tickets
        </Button>
        <Card className="shadow-sm">
          <CardContent className="p-6 text-center space-y-1">
            <p className="text-lg font-semibold text-slate-900">No se pudo abrir la consulta</p>
            <p className="text-sm text-slate-500">{errorMessage}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!ticket) return <div>Ticket no encontrado</div>;

  const handleStatusChange = (status: string) => {
    changeStatus.mutate({ 
      ticketId: id, 
      data: { status: status as TicketStatus } 
    });
  };

  const handlePostComment = () => {
    if (!commentText.trim()) return;
    addComment.mutate({
      ticketId: id,
      data: { content: commentText, isInternal }
    });
  };

  const handleOpenEdit = () => {
    setEditTitle(safeDisplayText(ticket.title ?? ""));
    setEditDescription(safeDisplayText(ticket.description ?? ""));
    setEditCategory(safeDisplayText(ticket.category ?? ""));
    setEditPriority((ticket.priority as TicketPriority) ?? TicketPriority.media);
    setEditStudentEmail(safeDisplayText(readField(ticket, "studentEmail") ?? ""));
    setEditOpen(true);
  };

  const handleSaveEdit = () => {
    updateTicket.mutate({
      ticketId: id,
      data: {
        title: editTitle.trim(),
        description: editDescription.trim(),
        category: editCategory.trim() || null,
        priority: editPriority,
        customFields: {
          ...(ticket.customFields ?? {}),
          studentEmail: editStudentEmail.trim() || null,
        },
      },
    });
  };

  const handleDeactivateTicket = () => {
    changeStatus.mutate({
      ticketId: id,
      data: {
        status: TicketStatus.cerrado,
        comment: "Consulta desactivada por el usuario.",
      },
    });
  };

  const handleOpenMeeAdmin = async () => {
    if (!meeAdminEmail) {
      toast({
        title: "No se pudo abrir MEE Admin",
        description: "Este ticket no tiene un email de alumno disponible.",
        variant: "destructive",
      });
      return;
    }

    if (window.desktopBridge?.openMeeUserManager) {
      await window.desktopBridge.openMeeUserManager(meeAdminEmail);
      return;
    }

    try {
      await navigator.clipboard.writeText(meeAdminEmail);
      toast({
        title: "Email copiado",
        description: "Se ha copiado el email del alumno para buscarlo en MEE Admin.",
      });
    } catch {
      // Si el navegador bloquea el portapapeles, abrimos la URL igualmente.
    }

    window.open("https://mee-admin.springernature.com/console", "_blank", "noopener,noreferrer");
  };

  const handleSearchSalesforce = async () => {
    if (!meeAdminEmail) {
      toast({
        title: "No se pudo buscar en Salesforce",
        description: "Este ticket no tiene un email disponible.",
        variant: "destructive",
      });
      return;
    }

    if (window.desktopBridge?.searchSalesforceEmail) {
      await window.desktopBridge.searchSalesforceEmail(meeAdminEmail);
      return;
    }

    try {
      await navigator.clipboard.writeText(meeAdminEmail);
    } catch {
      // Si el navegador bloquea el portapapeles, abrimos Salesforce igualmente.
    }

    window.open("https://macmillaneducation.my.salesforce.com/", "_blank", "noopener,noreferrer");
    toast({
      title: "Email copiado",
      description: "Se ha copiado el email para buscarlo en Salesforce.",
    });
  };

  const handleOpenMochilasOrder = async () => {
    if (!ticketOrderId) {
      toast({
        title: "No se pudo abrir el pedido",
        description: "Este ticket no tiene número de pedido guardado.",
        variant: "destructive",
      });
      return;
    }

    setIsLoadingOrder(true);
    try {
      const params = new URLSearchParams({ orderId: ticketOrderId });
      const tenantId = ticket?.tenantId ?? ticket?.customFields?.tenantId;
      if (tenantId) params.set("tenantId", String(tenantId));
      const result = await customFetch(`/api/tickets/mochilas/order?${params.toString()}`);
      setOrderLookup(result);
      setOrderDialogOpen(true);
    } catch (error) {
      toast({
        title: "No se pudo consultar el pedido",
        description: error instanceof Error ? safeDisplayText(error.message) : "No se pudo consultar la información en Mochilas.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingOrder(false);
    }
  };

  const handleOpenMeeResetPassword = async (tokenOverride?: unknown) => {
    const token = safeDisplayText(tokenOverride ?? meeAdminToken).trim();
    if (!token) {
      toast({
        title: "No se pudo cambiar la contraseña",
        description: "Este ticket no tiene token de Mochilas disponible.",
        variant: "destructive",
      });
      return;
    }

    if (window.desktopBridge?.openMeeResetPassword) {
      await window.desktopBridge.openMeeResetPassword(token);
      toast({
        title: "Contraseña preparada",
        description: "Se ha copiado Macmillaniberia al portapapeles.",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText("Macmillaniberia");
      toast({
        title: "Contraseña copiada",
        description: "Abre MEE Admin desde la app de escritorio para automatizar el cambio.",
      });
    } catch {
      toast({
        title: "Disponible solo en escritorio",
        description: "La automatización de MEE Admin solo está disponible en la app de escritorio.",
        variant: "destructive",
      });
    }
  };

  const handleCopyOrderValue = async (label: string, value: unknown) => {
    const text = safeDisplayText(value).trim();
    if (!text || text === "-") return;

    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: `${label} copiado`,
        description: text,
      });
    } catch {
      toast({
        title: "No se pudo copiar",
        description: "El navegador no permitió usar el portapapeles.",
        variant: "destructive",
      });
    }
  };

  const handleResetValidatedUserPassword = async () => {
    setIsResettingValidatedUser(true);
    try {
      const response = await customFetch<{ message: string }>(`/api/tickets/${id}/reset-validated-user-password`, {
        method: "POST",
      });
      toast({
        title: "Acceso restablecido",
        description: safeDisplayText(response?.message || "Se ha enviado un enlace seguro al usuario validado."),
      });
      setValidatedUserResetOpen(false);
      await Promise.all([refetchTicket(), refetchComments()]);
    } catch (error) {
      toast({
        title: "No se pudo restablecer el acceso",
        description: error instanceof Error ? safeDisplayText(error.message) : "Intentalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setIsResettingValidatedUser(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Button variant="ghost" onClick={() => setLocation("/tickets")} className="gap-2 -ml-4 text-slate-500">
        <ArrowLeft className="h-4 w-4" />
        Volver a tickets
      </Button>

      {/* Cabecera */}
      <Card className="border-t-4 border-t-primary shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                  #{ticket.ticketNumber}
                </span>
                <StatusBadge status={ticket.status} />
                <PriorityBadge priority={ticket.priority} />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                {safeDisplayText(ticket.title)}
              </h1>
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500 mt-2">
                <span className="flex items-center gap-1.5"><User className="h-4 w-4" /> {safeDisplayText(ticket.createdByName)}</span>
                <span className="flex items-center gap-1.5"><Building className="h-4 w-4" /> {safeDisplayText(ticket.schoolName || ticket.tenantName)}</span>
                <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> {format(new Date(ticket.createdAt), "d MMM yyyy HH:mm", { locale: es })}</span>
              </div>
            </div>

            {(isStaff || canManageTicket) && (
              <div className="flex flex-col sm:flex-row gap-3 md:min-w-[200px] shrink-0">
                {isStaff && (
                  <Select value={ticket.status} onValueChange={handleStatusChange}>
                    <SelectTrigger className="font-medium">
                      <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TicketStatus.nuevo}>Nuevo</SelectItem>
                      <SelectItem value={TicketStatus.pendiente}>Pendiente</SelectItem>
                      <SelectItem value={TicketStatus.en_revision}>En revisión</SelectItem>
                      <SelectItem value={TicketStatus.en_proceso}>En proceso</SelectItem>
                      <SelectItem value={TicketStatus.esperando_cliente}>Esperando cliente</SelectItem>
                      <SelectItem value={TicketStatus.resuelto}>Resuelto</SelectItem>
                      <SelectItem value={TicketStatus.cerrado}>Cerrado</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {showInlineManageButtons && (
                  <>
                    <Button variant="outline" className="gap-2" onClick={handleOpenEdit}>
                      <Pencil className="h-4 w-4" />
                      Editar consulta
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-2 text-rose-600 border-rose-200 hover:bg-rose-50"
                      disabled={ticket.status === TicketStatus.cerrado || changeStatus.isPending}
                      onClick={handleDeactivateTicket}
                    >
                      <XCircle className="h-4 w-4" />
                      Desactivar consulta
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </CardHeader>
      </Card>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Hilo principal */}
        <div className="md:col-span-2 space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <h2 className="text-lg font-semibold text-slate-900">{isAccessRequestTicket ? "Solicitud de acceso" : "Datos de la incidencia"}</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              {isAccessRequestTicket ? (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Origen</div>
                      <div className="mt-1 text-sm font-medium text-slate-900 whitespace-pre-wrap">
                        {accessSource === "forgot_password" ? "Olvide mi contrasena" : "Contacto desde pantalla de acceso"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Email del usuario validado</div>
                      <div className="mt-1 text-sm font-medium text-slate-900 whitespace-pre-wrap">
                        {requesterEmail || "-"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Nombre</div>
                      <div className="mt-1 text-sm font-medium text-slate-900 whitespace-pre-wrap">
                        {requesterName || "-"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Telefono</div>
                      <div className="mt-1 text-sm font-medium text-slate-900 whitespace-pre-wrap">
                        {requesterPhone || "-"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Colegio o centro</div>
                      <div className="mt-1 text-sm font-medium text-slate-900 whitespace-pre-wrap">
                        {requesterSchoolName || safeDisplayText(ticket.schoolName || ticket.tenantName) || "-"}
                      </div>
                    </div>
                  </div>

                  {canResetValidatedUserPassword && (
                    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-slate-900">Accion de soporte</p>
                          <p className="text-sm text-slate-600">
                            Enviaremos al usuario un enlace seguro y temporal para definir una nueva contrasena de acceso.
                          </p>
                        </div>
                        <Button type="button" className="gap-2" onClick={() => setValidatedUserResetOpen(true)}>
                          <KeyRound className="h-4 w-4" />
                          Resetear contrasena de usuario validado
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : incidentData.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {incidentData.map((item) => (
                    <div key={item.key} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">{safeDisplayText(item.label)}</div>
                      <div className="mt-1 text-sm font-medium text-slate-900 whitespace-pre-wrap">
                        {typeof item.value === "boolean" ? (item.value ? "Sí" : "No") : safeDisplayText(item.value)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                  Esta consulta no tiene datos adicionales de incidencia guardados.
                </div>
              )}
              {!isAccessRequestTicket && canUseMeeAdmin && (
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="outline" className="gap-2" onClick={() => void handleOpenMeeAdmin()}>
                    <ExternalLink className="h-4 w-4" />
                    Ver en MeeAdmin
                  </Button>
                  <Button type="button" variant="outline" className="gap-2" onClick={() => void handleSearchSalesforce()}>
                    <ExternalLink className="h-4 w-4" />
                    Buscar en Salesforce
                  </Button>
                  <Button type="button" variant="outline" className="gap-2" onClick={() => void handleOpenMeeResetPassword()}>
                    <KeyRound className="h-4 w-4" />
                    Cambiar contraseña
                  </Button>
                  <Button type="button" variant="outline" className="gap-2" onClick={() => void handleOpenMochilasOrder()} disabled={isLoadingOrder}>
                    <Backpack className="h-4 w-4" />
                    {isLoadingOrder ? "Consultando..." : "Ver pedido"}
                  </Button>
                </div>
              )}
              {!isAccessRequestTicket && actionItems.length > 0 && (
                <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Líneas marcadas en la consulta</p>
                    <p className="mt-1 text-xs text-slate-500">Estas líneas se seleccionaron durante la revisión de Mochilas o del pedido.</p>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Descripción</th>
                          <th className="px-3 py-2 font-semibold">ISBN</th>
                          <th className="px-3 py-2 font-semibold">Pedido</th>
                          <th className="px-3 py-2 font-semibold">Google</th>
                          <th className="px-3 py-2 font-semibold">Código de libro</th>
                          <th className="px-3 py-2 font-semibold">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {actionItems.map((item: any, index) => (
                          <tr key={item.key ?? `${item.orderId}-${item.isbn}-${index}`} className="border-t border-slate-200">
                            <td className="px-3 py-2 text-slate-900">{safeDisplayText(item.description ?? "-")}</td>
                            <td className="px-3 py-2 text-slate-900">{safeDisplayText(item.isbn ?? "-")}</td>
                            <td className="px-3 py-2 text-slate-900">{safeDisplayText(item.orderId ?? "-")}</td>
                            <td className="px-3 py-2 text-slate-900">{safeDisplayText(item.google ?? "-")}</td>
                            <td className="px-3 py-2 break-all text-slate-900">{safeDisplayText(item.bookCode ?? "-")}</td>
                            <td className="px-3 py-2 text-slate-900">
                              <div className="flex flex-wrap gap-2">
                                {Array.isArray(item.actions) && item.actions.length > 0 ? (
                                  item.actions.map((action: string) => (
                                    <span
                                      key={action}
                                      className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                                    >
                                      {action === "return" ? "Devolución" : action === "missing_book" ? "No ve el libro" : safeDisplayText(action)}
                                    </span>
                                  ))
                                ) : (
                                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                                    Devolución
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {!isAccessRequestTicket && mochilaRecords.length > 0 && (
                <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/70 p-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Libros activos en Mochilas</p>
                    <p className="mt-1 text-xs text-slate-500">Detalle detectado al buscar el alumno por email o pedido.</p>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Descripción</th>
                          <th className="px-3 py-2 font-semibold">ISBN</th>
                          <th className="px-3 py-2 font-semibold">Pedido</th>
                          <th className="px-3 py-2 font-semibold">Google</th>
                          <th className="px-3 py-2 font-semibold">Código de libro</th>
                          <th className="px-3 py-2 font-semibold">Token</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mochilaRecords.map((record: any, index: number) => (
                          <tr key={`${record?.idConsignaOrder ?? "line"}-${record?.ean ?? index}-${index}`} className="border-t border-slate-200">
                            <td className="px-3 py-2 text-slate-900">{safeDisplayText(record?.description || "-")}</td>
                            <td className="px-3 py-2 text-slate-900">{safeDisplayText(record?.ean || "-")}</td>
                            <td className="px-3 py-2 text-slate-900">{safeDisplayText(record?.idOrder ?? "") || "-"}</td>
                            <td className="px-3 py-2 text-slate-900">{record?.esGoogle ? "Sí" : "No"}</td>
                            <td className="px-3 py-2 break-all text-slate-900">{safeDisplayText(record?.idConsignaOrder ?? "-")}</td>
                            <td className="px-3 py-2 break-all text-slate-900">{safeDisplayText(record?.token || "-")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          {/* Descripción original */}
          <Card className="shadow-sm">
            <CardContent className="pt-6">
              <div className="prose dark:prose-invert max-w-none whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                {safeDisplayText(ticket.description)}
              </div>
            </CardContent>
          </Card>

          {/* Lista de comentarios */}
          <div className="space-y-4">
            {comments?.map((comment) => (
              <Card 
                key={comment.id} 
                className={`shadow-sm border-l-4 ${
                  comment.isInternal 
                    ? "border-l-amber-400 bg-amber-50/30 dark:bg-amber-900/10" 
                    : comment.authorRole.includes('cliente') 
                      ? "border-l-blue-400" 
                      : "border-l-slate-200 dark:border-l-slate-700"
                }`}
              >
                <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center font-semibold text-xs text-slate-600 dark:text-slate-300">
                      {safeDisplayText(comment.authorName).charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold text-sm flex items-center gap-2">
                        {safeDisplayText(comment.authorName)}
                        {comment.isInternal && (
                          <span className="text-[10px] uppercase font-bold tracking-wider bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Lock className="h-3 w-3" /> Interno
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">{format(new Date(comment.createdAt), "d MMM, HH:mm", { locale: es })}</div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                  <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                    {safeDisplayText(comment.content)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Caja de comentario nuevo */}
          <Card className={`shadow-sm border-2 ${isInternal ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50/20' : 'border-primary/20 focus-within:border-primary'}`}>
            <CardContent className="p-4">
              <Textarea 
                placeholder={isInternal ? "Escribe una nota interna (los clientes no la verán)..." : "Escribe una respuesta..."}
                className={`min-h-[120px] resize-y border-0 focus-visible:ring-0 p-0 shadow-none text-base bg-transparent ${isInternal ? 'placeholder:text-amber-700/40' : ''}`}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
              />
              
              <Separator className="my-4" />
              
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  {isStaff && (
                    <Button 
                      type="button" 
                      variant={isInternal ? "secondary" : "ghost"} 
                      size="sm"
                      className={`gap-2 ${isInternal ? 'bg-amber-100 hover:bg-amber-200 text-amber-900' : 'text-slate-500'}`}
                      onClick={() => setIsInternal(!isInternal)}
                    >
                      {isInternal ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                      Nota interna
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="gap-2 text-slate-500">
                    <Paperclip className="h-4 w-4" />
                    Adjuntar
                  </Button>
                </div>
                <Button 
                  onClick={handlePostComment} 
                  disabled={!commentText.trim() || addComment.isPending}
                  className={`gap-2 ${isInternal ? 'bg-amber-600 hover:bg-amber-700' : ''}`}
                >
                  <Send className="h-4 w-4" />
                  {isInternal ? 'Guardar nota' : 'Enviar respuesta'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Panel lateral */}
        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="p-4 pb-2">
              <h3 className="font-semibold text-sm uppercase tracking-wider text-slate-500">Propiedades</h3>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div>
                <div className="text-xs text-slate-500 mb-1">Categoría</div>
                <div className="font-medium text-sm capitalize">{safeDisplayText(ticket.category || 'Sin categoría')}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Asignado a</div>
                <div className="font-medium text-sm">{safeDisplayText(ticket.assignedToName || "Sin asignar")}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Red educativa</div>
                <div className="font-medium text-sm">{safeDisplayText(ticket.tenantName)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Colegio</div>
                <div className="font-medium text-sm">{safeDisplayText(ticket.schoolName || ticket.tenantName)}</div>
              </div>
              {extraCustomFields.length > 0 && (
                <>
                  <Separator />
                  {extraCustomFields.map(([key, val]) => (
                    <div key={key}>
                      <div className="text-xs text-slate-500 mb-1">{formatTicketFieldLabel(key)}</div>
                      <div className="font-medium text-sm whitespace-pre-wrap">{safeDisplayText(val)}</div>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>

          {isStaff && ticket.auditLogs && ticket.auditLogs.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="p-4 pb-2">
                <h3 className="font-semibold text-sm uppercase tracking-wider text-slate-500">Historial</h3>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="space-y-4">
                  {ticket.auditLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex gap-3 text-sm">
                      <div className="h-2 w-2 mt-1.5 rounded-full bg-slate-300 shrink-0" />
                      <div>
                        <span className="font-medium">{safeDisplayText(log.userName)}</span> {formatAuditAction(log.action)}
                        <div className="text-xs text-slate-500 mt-0.5">
                          {format(new Date(log.createdAt), "d MMM, HH:mm", { locale: es })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar consulta</DialogTitle>
            <DialogDescription>Actualiza los datos visibles de la incidencia sin borrar el historial.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="ticket-title">Asunto</Label>
              <Input id="ticket-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ticket-student-email">Email del alumno</Label>
                <Input id="ticket-student-email" value={editStudentEmail} onChange={(e) => setEditStudentEmail(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ticket-category">Categoría</Label>
                <Input id="ticket-category" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Prioridad</Label>
              <Select value={editPriority} onValueChange={(value) => setEditPriority(value as TicketPriority)}>
                <SelectTrigger>
                  <SelectValue placeholder="Prioridad" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TicketPriority.baja}>Baja</SelectItem>
                  <SelectItem value={TicketPriority.media}>Media</SelectItem>
                  <SelectItem value={TicketPriority.alta}>Alta</SelectItem>
                  <SelectItem value={TicketPriority.urgente}>Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ticket-description">Descripción</Label>
              <Textarea id="ticket-description" className="min-h-[180px]" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveEdit} disabled={updateTicket.isPending}>Guardar cambios</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={orderDialogOpen} onOpenChange={setOrderDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mochila #{safeDisplayText(orderRecord?.idConsignaOrder ?? ticketOrderId)}</DialogTitle>
            <DialogDescription>
              Registro: {safeDisplayText(orderRecord?.ean ?? "-")} · Pedido: {safeDisplayText(orderRecord?.idOrder ?? ticketOrderId)}
            </DialogDescription>
          </DialogHeader>

          {orderRecord ? (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <Card className="shadow-sm">
                <CardHeader>
                  <h3 className="text-lg font-semibold text-slate-900">Información del alumno</h3>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Nombre</Label>
                      <Input value={safeDisplayText(orderRecord.studentName ?? "-")} readOnly />
                    </div>
                    <div className="space-y-1">
                      <Label>Apellidos</Label>
                      <Input value={safeDisplayText(orderRecord.studentSurname ?? "-")} readOnly />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label>Colegio</Label>
                    <Input value={safeDisplayText(orderRecord.schoolName ?? "-")} readOnly />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Email del alumno</Label>
                      <Input value={safeDisplayText(orderRecord.studentEmail ?? orderLookup?.studentEmail ?? "-")} readOnly />
                    </div>
                    <div className="space-y-1">
                      <Label>Usuario del alumno / Login</Label>
                      <Input value={safeDisplayText(orderRecord.studentUser ?? orderLookup?.studentUser ?? "-")} readOnly />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Contraseña</Label>
                      <Input value={safeDisplayText(orderRecord.studentPassword ?? orderLookup?.studentPassword ?? "-")} readOnly />
                    </div>
                    <div className="flex items-center gap-3 pt-7">
                      <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={!!orderRecord.esGoogle} readOnly />
                      <span className="text-sm font-medium text-slate-700">Cuenta Google</span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-1">
                    <Label>Notas / Descripción</Label>
                    <Textarea className="min-h-[110px]" value={safeDisplayText(orderRecord.description ?? "-")} readOnly />
                  </div>

                  {orderRecords.length > 1 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-slate-900">Líneas del pedido</h4>
                      <div className="overflow-hidden rounded-lg border border-slate-200">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-3 py-2 font-semibold">Descripción</th>
                              <th className="px-3 py-2 font-semibold">EAN</th>
                              <th className="px-3 py-2 font-semibold">Token</th>
                              <th className="px-3 py-2 font-semibold">Tipo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orderRecords.map((record: any, index: number) => (
                              <tr key={`${record?.idConsignaOrder ?? "line"}-${record?.ean ?? index}-${index}`} className="border-t border-slate-200">
                                <td className="px-3 py-2">{safeDisplayText(record?.description ?? "-")}</td>
                                <td className="px-3 py-2">{safeDisplayText(record?.ean ?? "-")}</td>
                                <td className="px-3 py-2 break-all">{safeDisplayText(record?.token ?? "-")}</td>
                                <td className="px-3 py-2">{safeDisplayText(record?.type ?? "-")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card className="shadow-sm">
                  <CardHeader>
                    <h3 className="text-lg font-semibold text-slate-900">Estado y entrega</h3>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start gap-3">
                        <input type="checkbox" className="mt-1 h-4 w-4 rounded border-slate-300" checked readOnly />
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Registro encontrado</p>
                          <p className="mt-1 text-sm text-slate-500">El pedido existe en dbo.MOC_Mochilas.</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm">
                  <CardHeader>
                    <h3 className="text-lg font-semibold text-slate-900">Datos del sistema</h3>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-slate-500">ID de consigna</span>
                      <div className="flex items-center gap-2 text-right">
                        <span className="font-mono text-slate-900">{safeDisplayText(orderRecord.idConsignaOrder ?? "-")}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void handleCopyOrderValue("ID de consigna", orderRecord.idConsignaOrder)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-slate-500">Token</span>
                      <div className="flex items-center gap-2 text-right">
                        <span className="max-w-[170px] break-all font-mono text-slate-900">{safeDisplayText(orderRecord.token ?? "-")}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => void handleCopyOrderValue("Token", orderRecord.token)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-slate-500">ID de pedido</span>
                      <div className="flex items-center gap-2 text-right">
                        <span className="font-mono text-slate-900">{safeDisplayText(orderRecord.idOrder ?? ticketOrderId)}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void handleCopyOrderValue("ID de pedido", orderRecord.idOrder ?? ticketOrderId)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-slate-500">EAN</span>
                      <div className="flex items-center gap-2 text-right">
                        <span className="font-mono text-slate-900">{safeDisplayText(orderRecord.ean ?? "-")}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void handleCopyOrderValue("EAN", orderRecord.ean)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-slate-500">Tipo</span>
                      <span className="font-medium text-slate-900">{safeDisplayText(orderRecord.type ?? "-")}</span>
                    </div>
                    <Button type="button" variant="outline" className="w-full gap-2" onClick={() => void handleOpenMeeAdmin()}>
                      <ExternalLink className="h-4 w-4" />
                      Ver en MEE Admin
                    </Button>
                    <Button type="button" variant="outline" className="w-full gap-2" onClick={() => void handleOpenMeeResetPassword(orderRecord.token)}>
                      <KeyRound className="h-4 w-4" />
                      Cambiar contraseña
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              No se encontraron datos del pedido en Mochilas.
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={validatedUserResetOpen} onOpenChange={setValidatedUserResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resetear acceso del usuario validado</DialogTitle>
            <DialogDescription>
              Se generara un enlace seguro y temporal para que el usuario defina una nueva contrasena de acceso. Esta accion quedara registrada internamente en el ticket.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p><strong>Usuario:</strong> {requesterName || "-"}</p>
            <p><strong>Email:</strong> {requesterEmail || "-"}</p>
            <p><strong>Ticket:</strong> {ticket.ticketNumber}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setValidatedUserResetOpen(false)} disabled={isResettingValidatedUser}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleResetValidatedUserPassword()} disabled={isResettingValidatedUser}>
              {isResettingValidatedUser ? "Enviando..." : "Confirmar reseteo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

