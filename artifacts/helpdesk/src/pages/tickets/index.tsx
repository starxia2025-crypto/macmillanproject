import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { TicketStatus, useAssignTicket, useChangeTicketStatus, useGetMe, useListTickets } from "@workspace/api-client-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusBadge, PriorityBadge } from "@/components/badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { buildApiUrl } from "@/lib/api-base-url";
import { Search, Plus, Filter, MessageSquare, Clock, CheckCircle2, Inbox, UserRoundCheck, Eye, ArrowRight, Upload, Loader2, FileSpreadsheet } from "lucide-react";

const openStatuses = ["nuevo", "pendiente", "en_revision", "en_proceso", "esperando_cliente"];
const bulkImportHeaders = [
  "red_educativa",
  "colegio",
  "email_informador",
  "tipo_sujeto",
  "email_afectado",
  "prioridad",
  "estado",
  "tipo_consulta",
  "descripcion",
  "pedido",
  "matricula",
  "etapa",
  "curso",
  "asignatura",
  "observaciones",
] as const;
const bulkSubjectOptions = ["alumno", "docente", "sobre_mi_cuenta"] as const;
const bulkPriorityOptions = ["baja", "media", "alta", "urgente"] as const;
const bulkStatusOptions = ["nuevo", "pendiente", "en_revision", "en_proceso", "esperando_cliente", "resuelto", "cerrado"] as const;
const bulkInquiryOptions = [
  "Alumno sin libros",
  "No puede acceder",
  "Problemas de activación",
  "No funciona el libro",
  "Otro",
] as const;

type BulkImportRow = Record<(typeof bulkImportHeaders)[number], string>;
type BulkImportPhase = "idle" | "reading" | "uploading" | "finalizing";

const importPhaseMeta: Record<BulkImportPhase, { value: number; label: string; helper: string }> = {
  idle: { value: 0, label: "", helper: "" },
  reading: {
    value: 28,
    label: "Leyendo el Excel",
    helper: "Estamos validando columnas y preparando las filas para importarlas.",
  },
  uploading: {
    value: 72,
    label: "Creando consultas",
    helper: "Estamos enviando el fichero al servidor y generando los tickets.",
  },
  finalizing: {
    value: 96,
    label: "Actualizando la bandeja",
    helper: "Cerrando la importación y refrescando la lista de consultas.",
  },
};

function fixMojibake(value: string) {
  let next = value;

  if (/[ÃÂâ]/.test(next)) {
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
    [/contrase\?a/gi, "contraseña"],
    [/espa\?ol/gi, "español"],
    [/atenci\?n/gi, "atención"],
    [/soluci\?n/gi, "solución"],
    [/Inténtalo/gi, "Inténtalo"],
    [/Descripción/gi, "Descripción"],
    [/Categoría/gi, "Categoría"],
    [/categoría/gi, "categoría"],
    [/Revisión/gi, "Revisión"],
    [/revisión/gi, "revisión"],
    [/devolución/gi, "devolución"],
    [/verán/gi, "verán"],
    [/Ã¡/g, "á"],
    [/Ã©/g, "é"],
    [/Ã­/g, "í"],
    [/Ã³/g, "ó"],
    [/Ãº/g, "ú"],
    [/Ã±/g, "ñ"],
    [/Âº/g, "º"],
    [/Â·/g, "·"],
  ];

  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), next);
}

function safeDisplayText(value: unknown): string {
  return fixMojibake(String(value ?? ""));
}

function normalizeBulkCellValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object" && value && "text" in (value as Record<string, unknown>)) {
    return fixMojibake(String((value as Record<string, unknown>).text ?? "").trim());
  }

  return fixMojibake(String(value).trim());
}

async function parseBulkImportWorkbook(file: File): Promise<BulkImportRow[]> {
  const excelModule = await import("exceljs");
  const ExcelJS = excelModule.default ?? excelModule;
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.getWorksheet("Consultas") ?? workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("El archivo no contiene ninguna hoja valida.");
  }

  const headerMap = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const key = normalizeBulkCellValue(cell.value).toLowerCase();
    if (key) headerMap.set(key, colNumber);
  });

  const missingHeaders = bulkImportHeaders.filter((header) => !headerMap.has(header.toLowerCase()));
  if (missingHeaders.length > 0) {
    throw new Error(`Faltan columnas obligatorias en el Excel: ${missingHeaders.join(", ")}.`);
  }

  const rows: BulkImportRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values = Object.fromEntries(
      bulkImportHeaders.map((header) => {
        const index = headerMap.get(header.toLowerCase())!;
        return [header, normalizeBulkCellValue(row.getCell(index).value)];
      }),
    ) as BulkImportRow;

    if (Object.values(values).some(Boolean)) {
      rows.push(values);
    }
  }

  if (rows.length === 0) {
    throw new Error("El Excel no contiene filas de datos para importar.");
  }

  return rows;
}

function getTicketSubtitle(ticket: any) {
  const school = safeDisplayText(ticket.schoolName || ticket.customFields?.school || ticket.category || ticket.tenantName || "Colegio");
  const inquiryType = safeDisplayText(ticket.customFields?.inquiryType || ticket.customFields?.subjectType || "Consulta general");
  const studentEmail = ticket.customFields?.studentEmail ? safeDisplayText(ticket.customFields.studentEmail) : null;
  return { school, inquiryType, studentEmail };
}

function normalizeTicketText(value: unknown) {
  return safeDisplayText(value).trim().toLowerCase();
}

function isChangeEmailTicket(ticket: any) {
  return (
    normalizeTicketText(ticket.title) === "modificar correo" ||
    normalizeTicketText(ticket.category) === "modificar_correo" ||
    normalizeTicketText(ticket.customFields?.inquiryType) === "modificar correo" ||
    ticket.customFields?.changeEmailRequested === true
  );
}

function isReturnTicket(ticket: any) {
  const lineActions = Array.isArray(ticket.customFields?.lineActions) ? ticket.customFields.lineActions : [];
  return (
    normalizeTicketText(ticket.title) === "devolucion" ||
    normalizeTicketText(ticket.category) === "devolucion" ||
    normalizeTicketText(ticket.customFields?.inquiryType) === "devolucion" ||
    ticket.customFields?.returnRequested === true ||
    lineActions.some((item: any) => Array.isArray(item?.actions) && item.actions.includes("return"))
  );
}

async function openMeeUserManagerForTicket(ticket: any) {
  const email = safeDisplayText(
    ticket.customFields?.currentStudentEmail ??
      ticket.customFields?.studentEmail ??
      ticket.customFields?.affectedEmail ??
      ""
  )
    .trim()
    .toLowerCase();
  const meeAdminUrl = "https://mee-admin.springernature.com/console";

  if (!email) {
    throw new Error("Este ticket no tiene un email de alumno disponible.");
  }

  if (window.desktopBridge?.openMeeUserManager) {
    await window.desktopBridge.openMeeUserManager(email);
    return;
  }

  try {
    await navigator.clipboard.writeText(email);
  } catch {
    // Si el navegador bloquea el portapapeles, al menos abrimos la URL.
  }

  window.open(meeAdminUrl, "_blank", "noopener,noreferrer");
}

async function sendResolvedTicketEmailForDesktop(ticket: any, resolverName?: string | null) {
  if (!window.desktopBridge?.sendResolvedTicketEmail) {
    return;
  }

  await window.desktopBridge.sendResolvedTicketEmail({
    ticketNumber: safeDisplayText(ticket.ticketNumber),
    title: safeDisplayText(ticket.title),
    description: safeDisplayText(ticket.description),
    status: "resuelto",
    priority: safeDisplayText(ticket.priority),
    creatorName: safeDisplayText(ticket.createdByName),
    creatorEmail: safeDisplayText(ticket.customFields?.reporterEmail ?? ""),
    schoolName: safeDisplayText(ticket.schoolName),
    tenantName: safeDisplayText(ticket.tenantName),
    resolvedByName: safeDisplayText(resolverName ?? ""),
    resolvedAt: new Date().toLocaleString("es-ES"),
  });
}

function buildBulkImportTemplateRow(user: { email?: string | null; schoolName?: string | null; tenantName?: string | null } | undefined) {
  const school = user?.schoolName || user?.tenantName || "Colegio";
  const reporterEmail = user?.email || "informador@colegio.es";

  return [
    user?.tenantName || "Red educativa",
    school,
    reporterEmail,
    "alumno",
    "alumno@centro.es",
    "media",
    "nuevo",
    "No puede acceder",
    "El alumno no puede entrar en la plataforma desde hoy.",
    "10125633",
    "2153",
    "Primaria",
    "5º",
    "Inglés",
    "Intentado en dos navegadores",
  ] as const;
}

async function downloadBulkTemplate(user: { email?: string | null; schoolName?: string | null; tenantName?: string | null } | undefined) {
  const excelModule = await import("exceljs");
  const ExcelJS = excelModule.default ?? excelModule;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Consultas");
  const exampleRow = buildBulkImportTemplateRow(user);
  const schoolForFile = (user?.schoolName || user?.tenantName || "colegio").toLowerCase().replace(/\s+/g, "-");

  worksheet.addRow([...bulkImportHeaders]);
  worksheet.addRow([...exampleRow]);

  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  const widths = [22, 24, 30, 18, 28, 14, 18, 26, 42, 14, 14, 16, 12, 16, 28];
  widths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });

  const dataRow = worksheet.getRow(2);
  dataRow.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "FFE2E8F0" } },
      left: { style: "thin", color: { argb: "FFE2E8F0" } },
      bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      right: { style: "thin", color: { argb: "FFE2E8F0" } },
    };
  });

  for (let row = 2; row <= 200; row += 1) {
    worksheet.getCell(`D${row}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`"${bulkSubjectOptions.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Valor no válido",
      error: "Selecciona uno de los valores permitidos para tipo_sujeto.",
    };
    worksheet.getCell(`F${row}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`"${bulkPriorityOptions.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Valor no válido",
      error: "Selecciona una prioridad permitida.",
    };
    worksheet.getCell(`G${row}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`"${bulkStatusOptions.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Valor no válido",
      error: "Selecciona uno de los estados permitidos.",
    };
    worksheet.getCell(`H${row}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`"${bulkInquiryOptions.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Valor no válido",
      error: "Selecciona uno de los tipos de consulta permitidos.",
    };
  }

  const helpSheet = workbook.addWorksheet("Ayuda");
  helpSheet.addRows([
    ["Campo", "Qué debe contener"],
    ["red_educativa", "Red educativa destino en el sistema. Ejemplo: Edelvives."],
    ["colegio", "Nombre visible del colegio para el ticket y las estadísticas. No crea colegios nuevos en el sistema."],
    ["tipo_sujeto", "alumno, docente o sobre_mi_cuenta"],
    ["prioridad", "baja, media, alta o urgente"],
    ["estado", "nuevo, pendiente, en_revision, en_proceso, esperando_cliente, resuelto o cerrado"],
    ["tipo_consulta", bulkInquiryOptions.join(" | ")],
    ["pedido", "Opcional. Solo si la incidencia viene de Mochilas o pedidos."],
  ]);
  helpSheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `plantilla-consultas-${schoolForFile}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function SupportTicketCard({
  ticket,
  currentUserId,
  onTake,
  onResolve,
  busy,
}: {
  ticket: any;
  currentUserId: number;
  onTake: (ticketId: number) => void;
  onResolve: (ticketId: number) => void;
  busy?: boolean;
}) {
  const [, setLocation] = useLocation();
  const { school, inquiryType, studentEmail } = getTicketSubtitle(ticket);
  const isMine = ticket.assignedToId === currentUserId;
  const occupiedByOther = !!ticket.assignedToId && ticket.assignedToId !== currentUserId;
  const contextualActionLabel = isChangeEmailTicket(ticket)
    ? "Cambiar correo"
    : isReturnTicket(ticket)
      ? "Cancelar token"
      : null;

  const handleContextualAction = () => {
    if (isChangeEmailTicket(ticket)) {
      void openMeeUserManagerForTicket(ticket).catch((error) => {
        toast({
          title: "No se pudo abrir MEE Admin",
          description: error instanceof Error ? error.message : "Intentalo de nuevo.",
          variant: "destructive",
        });
      });
      if (!window.desktopBridge?.openMeeUserManager) {
        toast({
          title: "MEE Admin abierto",
          description: "Se ha abierto la web corporativa en una nueva pestaña y se ha intentado copiar el email del alumno.",
        });
      }
      return;
    }

    setLocation(`/tickets/${ticket.id}`);
  };

  return (
    <Card className="overflow-hidden border-slate-200 shadow-sm transition hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-600">#{ticket.ticketNumber}</span>
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
              {occupiedByOther && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">Ocupado por {ticket.assignedToName}</span>}
              {isMine && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">En mis manos</span>}
            </div>

            <div>
              <h3 className="line-clamp-2 text-lg font-semibold text-slate-900">{safeDisplayText(ticket.title)}</h3>
              <p className="mt-1 text-sm text-slate-500">{school} Â· {inquiryType}</p>
            </div>

            <div className="grid gap-3 text-sm text-slate-500 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Informador</p>
                <p className="font-medium text-slate-700">{ticket.createdByName}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Actualizado</p>
                <p className="font-medium text-slate-700">{formatDistanceToNow(new Date(ticket.updatedAt), { addSuffix: true, locale: es })}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Comentarios</p>
                <p className="flex items-center gap-1 font-medium text-slate-700"><MessageSquare className="h-3.5 w-3.5" /> {ticket.commentCount}</p>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 lg:w-[190px]">
            {!ticket.assignedToId && openStatuses.includes(ticket.status) && (
              <Button className="gap-2" onClick={() => onTake(ticket.id)}>
                <UserRoundCheck className="h-4 w-4" />
                Tomar ticket
              </Button>
            )}
            {isMine && ticket.status !== "resuelto" && ticket.status !== "cerrado" && (
              <Button variant="secondary" className="gap-2" onClick={() => onResolve(ticket.id)}>
                <CheckCircle2 className="h-4 w-4" />
                Marcar resuelto
              </Button>
            )}
            {isMine && ticket.status !== "resuelto" && ticket.status !== "cerrado" && contextualActionLabel && (
              <Button variant="outline" className="gap-2" onClick={handleContextualAction}>
                {contextualActionLabel}
              </Button>
            )}
            {busy && occupiedByOther && (
              <Button variant="outline" disabled className="gap-2">
                <Eye className="h-4 w-4" />
                Lo esta viendo otro
              </Button>
            )}
            <Button variant="outline" className="gap-2" onClick={() => setLocation(`/tickets/${ticket.id}`)}>
              Abrir detalle
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Tickets() {
  const [, setLocation] = useLocation();
  const { data: user } = useGetMe();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [activeSupportTab, setActiveSupportTab] = useState("queue");
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importPhase, setImportPhase] = useState<BulkImportPhase>("idle");

  const isSupportTech = user?.role === "tecnico";
  const canBulkImport = ["superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"].includes(user?.role || "");
  const showSchoolColumn = user?.scopeType === "tenant" || user?.scopeType === "global" || user?.role === "superadmin" || user?.role === "tecnico";

  const { data: ticketsData, isLoading, refetch } = useListTickets({
    page,
    limit: isSupportTech ? 100 : 20,
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    priority: priorityFilter !== "all" ? priorityFilter : undefined,
    tenantId: user?.role === "superadmin" || user?.role === "tecnico" ? undefined : user?.tenantId,
  });

  const assignTicket = useAssignTicket({
    mutation: {
      onSuccess: async () => {
        setActiveSupportTab("mine");
        toast({ title: "Ticket tomado", description: "El ticket ya figura en tu bandeja de trabajo." });
        await refetch();
      },
      onError: (error) => {
        toast({
          title: "No se pudo tomar el ticket",
          description: error instanceof Error ? error.message : "Intentalo de nuevo.",
          variant: "destructive",
        });
      },
    },
  });

  const changeStatus = useChangeTicketStatus({
    mutation: {
      onSuccess: async () => {
        toast({ title: "Ticket actualizado", description: "El estado del ticket se ha guardado correctamente." });
        await refetch();
      },
      onError: (error) => {
        toast({
          title: "No se pudo actualizar el ticket",
          description: error instanceof Error ? error.message : "Intentalo de nuevo.",
          variant: "destructive",
        });
      },
    },
  });

  const filteredSupportTickets = useMemo(() => (ticketsData?.data ?? []), [ticketsData?.data]);

  const supportView = useMemo(() => {
    const queue = filteredSupportTickets.filter((ticket) => openStatuses.includes(ticket.status) && !ticket.assignedToId);
    const mine = filteredSupportTickets.filter((ticket) => openStatuses.includes(ticket.status) && ticket.assignedToId === user?.id);
    const occupied = filteredSupportTickets.filter((ticket) => openStatuses.includes(ticket.status) && ticket.assignedToId && ticket.assignedToId !== user?.id);
    const resolved = filteredSupportTickets.filter((ticket) => ticket.status === "resuelto" || ticket.status === "cerrado");
    return { queue, mine, occupied, resolved };
  }, [filteredSupportTickets, user?.id]);

  function handleTakeTicket(ticketId: number) {
    if (!user?.id) return;
    assignTicket.mutate({ ticketId, data: { userId: user.id } });
    changeStatus.mutate({ ticketId, data: { status: TicketStatus.en_proceso } });
  }

  async function handleResolveTicket(ticketId: number) {
    const ticket = filteredSupportTickets.find((item) => item.id === ticketId);
    await changeStatus.mutateAsync({ ticketId, data: { status: TicketStatus.resuelto } });

    if (!ticket) {
      return;
    }

    try {
      await sendResolvedTicketEmailForDesktop(ticket, user?.name);
    } catch (error) {
      toast({
        title: "Ticket resuelto, pero no se pudo enviar el correo",
        description: error instanceof Error ? error.message : "Revisa Outlook en este equipo.",
        variant: "destructive",
      });
    }
  }

  async function handleImportFile() {
    if (!selectedImportFile) {
      toast({
        title: "Selecciona un archivo",
        description: "Elige primero el Excel que quieres importar.",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    setImportPhase("reading");
    try {
      const rows = await parseBulkImportWorkbook(selectedImportFile);
      setImportPhase("uploading");
      const response = await fetch(buildApiUrl("/api/tickets/import"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rows }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || "No se pudo importar el fichero.");
      }

      setImportPhase("finalizing");
      toast({
        title: "Importación completada",
        description: `Se han creado ${payload?.createdCount ?? 0} consultas${payload?.warnings?.length ? ` y ${payload.warnings.length} filas necesitaron ajuste` : ""}.`,
      });
      setSelectedImportFile(null);
      await refetch();
    } catch (error) {
      toast({
        title: "No se pudo importar el Excel",
        description: error instanceof Error ? error.message : "Revisa el archivo e inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      setImportPhase("idle");
    }
  }

  if (isSupportTech) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Bandeja tecnica</h1>
            <p className="mt-1 text-slate-500">Toma tickets pendientes, controla los que estan en manos de otros tecnicos y cierra los tuyos cuando queden resueltos.</p>
          </div>

          <Card className="w-full max-w-xl border-0 bg-white/80 shadow-sm">
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Buscar ticket, colegio o asunto..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="w-[170px]"><SelectValue placeholder="Prioridad" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="baja">Baja</SelectItem>
                    <SelectItem value="media">Media</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[170px]"><SelectValue placeholder="Estado" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="nuevo">Nuevo</SelectItem>
                    <SelectItem value="pendiente">Pendiente</SelectItem>
                    <SelectItem value="en_revision">En revision</SelectItem>
                    <SelectItem value="en_proceso">En proceso</SelectItem>
                    <SelectItem value="esperando_cliente">Esperando cliente</SelectItem>
                    <SelectItem value="resuelto">Resuelto</SelectItem>
                    <SelectItem value="cerrado">Cerrado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card
            className="cursor-pointer border-0 bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-sm transition hover:scale-[1.01]"
            onClick={() => setActiveSupportTab("queue")}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">Sin asignar</p>
                  <p className="mt-2 text-3xl font-bold">{supportView.queue.length}</p>
                </div>
                <Inbox className="h-8 w-8 text-white/70" />
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer border-0 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm transition hover:scale-[1.01]"
            onClick={() => setActiveSupportTab("mine")}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">Mis tickets</p>
                  <p className="mt-2 text-3xl font-bold">{supportView.mine.length}</p>
                </div>
                <UserRoundCheck className="h-8 w-8 text-white/70" />
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer border-0 bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-sm transition hover:scale-[1.01]"
            onClick={() => setActiveSupportTab("occupied")}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">Ocupados por otros</p>
                  <p className="mt-2 text-3xl font-bold">{supportView.occupied.length}</p>
                </div>
                <Eye className="h-8 w-8 text-white/70" />
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer border-0 bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-sm transition hover:scale-[1.01]"
            onClick={() => setActiveSupportTab("resolved")}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">Resueltos</p>
                  <p className="mt-2 text-3xl font-bold">{supportView.resolved.length}</p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-white/70" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeSupportTab} onValueChange={setActiveSupportTab} className="space-y-4">
          <TabsList className="h-auto flex-wrap justify-start gap-2 bg-transparent p-0">
            <TabsTrigger value="queue">Pendientes sin asignar</TabsTrigger>
            <TabsTrigger value="mine">Mis tickets</TabsTrigger>
            <TabsTrigger value="occupied">Ocupados por otros</TabsTrigger>
            <TabsTrigger value="resolved">Resueltos</TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="space-y-4">
            {supportView.queue.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-slate-500">No hay tickets pendientes sin asignar con los filtros actuales.</CardContent></Card>
            ) : (
              supportView.queue.map((ticket) => (
                <SupportTicketCard key={ticket.id} ticket={ticket} currentUserId={user!.id} onTake={handleTakeTicket} onResolve={handleResolveTicket} />
              ))
            )}
          </TabsContent>

          <TabsContent value="mine" className="space-y-4">
            {supportView.mine.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-slate-500">Todavia no tienes tickets tomados.</CardContent></Card>
            ) : (
              supportView.mine.map((ticket) => (
                <SupportTicketCard key={ticket.id} ticket={ticket} currentUserId={user!.id} onTake={handleTakeTicket} onResolve={handleResolveTicket} />
              ))
            )}
          </TabsContent>

          <TabsContent value="occupied" className="space-y-4">
            {supportView.occupied.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-slate-500">No hay tickets ocupados por otros tecnicos ahora mismo.</CardContent></Card>
            ) : (
              supportView.occupied.map((ticket) => (
                <SupportTicketCard key={ticket.id} ticket={ticket} currentUserId={user!.id} onTake={handleTakeTicket} onResolve={handleResolveTicket} busy />
              ))
            )}
          </TabsContent>

          <TabsContent value="resolved" className="space-y-4">
            {supportView.resolved.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-slate-500">No hay tickets resueltos con los filtros actuales.</CardContent></Card>
            ) : (
              supportView.resolved.map((ticket) => (
                <SupportTicketCard key={ticket.id} ticket={ticket} currentUserId={user!.id} onTake={handleTakeTicket} onResolve={handleResolveTicket} />
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  const currentImportPhase = importPhaseMeta[importPhase];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Tickets de consulta</h1>
          <p className="mt-1 text-slate-500">Consulta el estado y la actividad de tus incidencias.</p>
        </div>
        {user?.role !== undefined && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {canBulkImport && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Upload className="h-4 w-4" />
                    Importación masiva
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-xl">
                  <DialogHeader>
                    <DialogTitle>Importación masiva de consultas</DialogTitle>
                    <DialogDescription>
                      Descarga la plantilla, completa una fila por consulta y súbela aquí cuando la tengas lista.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 text-sm text-slate-600">
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                      <p className="font-medium text-slate-900">La plantilla incluye</p>
                      <p className="mt-2 text-slate-600">
                        Una fila de ejemplo y listas desplegables en <span className="font-medium">tipo_sujeto</span>, <span className="font-medium">prioridad</span>, <span className="font-medium">estado</span> y <span className="font-medium">tipo_consulta</span>.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 p-4">
                        <p className="font-medium text-slate-900">Valores clave</p>
                        <ul className="mt-2 space-y-1 text-slate-600">
                          <li><span className="font-medium">tipo_sujeto</span>: alumno, docente, sobre_mi_cuenta</li>
                          <li><span className="font-medium">prioridad</span>: baja, media, alta, urgente</li>
                          <li><span className="font-medium">estado</span>: nuevo, pendiente, resuelto...</li>
                        </ul>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-4">
                        <p className="font-medium text-slate-900">Importante</p>
                        <ul className="mt-2 space-y-1 text-slate-600">
                          <li>Una fila por consulta.</li>
                          <li>No cambies los encabezados.</li>
                          <li>Sube el archivo en formato <span className="font-medium">.xlsx</span>.</li>
                        </ul>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">
                      <p className="font-medium text-slate-900">Subir fichero</p>
                      <div className="mt-3 space-y-3">
                        <Input
                          type="file"
                          accept=".xlsx"
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            setSelectedImportFile(file);
                          }}
                        />
                        <p className="text-xs text-slate-500">
                          {selectedImportFile
                            ? `Archivo seleccionado: ${selectedImportFile.name}`
                            : "Selecciona el Excel ya preparado para crear las consultas en lote."}
                        </p>
                        {isImporting && (
                          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-violet-50 p-4 shadow-sm">
                            <div className="flex items-center gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                                {importPhase === "reading" ? (
                                  <FileSpreadsheet className="h-5 w-5" />
                                ) : importPhase === "uploading" ? (
                                  <Upload className="h-5 w-5" />
                                ) : (
                                  <Loader2 className="h-5 w-5 animate-spin" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-semibold text-slate-900">{currentImportPhase.label}</p>
                                  <span className="text-xs font-medium text-slate-500">{currentImportPhase.value}%</span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">{currentImportPhase.helper}</p>
                              </div>
                            </div>
                            <Progress value={currentImportPhase.value} className="mt-4 h-2.5 bg-indigo-100 [&>div]:bg-gradient-to-r [&>div]:from-indigo-500 [&>div]:to-violet-500" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void downloadBulkTemplate(user).catch(() => {
                          toast({
                            title: "No se pudo generar la plantilla",
                            description: "Falta preparar la dependencia de Excel. Ejecuta pnpm install y vuelve a intentarlo.",
                            variant: "destructive",
                          });
                        });
                      }}
                    >
                      Descargar plantilla Excel
                    </Button>
                    <Button type="button" onClick={() => void handleImportFile()} disabled={!selectedImportFile || isImporting} className="gap-2">
                      {isImporting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Importando...
                        </>
                      ) : (
                        "Importar Excel"
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            <Button onClick={() => setLocation("/tickets/new")} className="gap-2">
              <Plus className="h-4 w-4" />
              Nueva consulta
            </Button>
          </div>
        )}
      </div>

      <Card className="p-4 flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por asunto, numero o colegio..."
            className="pl-9 w-full"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="nuevo">Nuevo</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="en_revision">En revision</SelectItem>
              <SelectItem value="en_proceso">En proceso</SelectItem>
              <SelectItem value="esperando_cliente">Esperando cliente</SelectItem>
              <SelectItem value="resuelto">Resuelto</SelectItem>
              <SelectItem value="cerrado">Cerrado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Prioridad" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las prioridades</SelectItem>
              <SelectItem value="baja">Baja</SelectItem>
              <SelectItem value="media">Media</SelectItem>
              <SelectItem value="alta">Alta</SelectItem>
              <SelectItem value="urgente">Urgente</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon"><Filter className="h-4 w-4" /></Button>
        </div>
      </Card>

      <div className="bg-white dark:bg-slate-900 border rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
            <TableRow>
              <TableHead className="w-[100px] font-semibold">ID</TableHead>
              <TableHead className="font-semibold">Consulta</TableHead>
              <TableHead className="font-semibold">Estado</TableHead>
              <TableHead className="font-semibold">Prioridad</TableHead>
              {showSchoolColumn && <TableHead className="font-semibold">Colegio</TableHead>}
              <TableHead className="text-right font-semibold">Actividad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><div className="h-5 w-16 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-5 w-64 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-6 w-20 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" /></TableCell>
                  <TableCell><div className="h-6 w-20 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" /></TableCell>
                  {user?.role === "superadmin" && <TableCell><div className="h-5 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>}
                  <TableCell><div className="h-5 w-20 bg-slate-100 dark:bg-slate-800 rounded animate-pulse ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : ticketsData?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showSchoolColumn ? 6 : 5} className="h-48 text-center text-slate-500">
                  No se encontraron tickets con los criterios indicados.
                </TableCell>
              </TableRow>
            ) : (
              ticketsData?.data.map((ticket) => {
                const { school, inquiryType, studentEmail } = getTicketSubtitle(ticket);
                return (
                  <TableRow key={ticket.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors" onClick={() => setLocation(`/tickets/${ticket.id}`)}>
                    <TableCell className="font-mono text-xs font-medium text-slate-500">#{ticket.ticketNumber}</TableCell>
                    <TableCell>
                      <div className="font-medium text-slate-900 dark:text-slate-100 mb-1 line-clamp-1">{safeDisplayText(ticket.title)}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-2">
                        <span className="truncate max-w-[200px]">{school}</span>
                        <span>Â·</span>
                        <span>{inquiryType}</span>
                      </div>
                      {studentEmail ? <div className="mt-1 text-xs text-slate-500">Alumno afectado: {studentEmail}</div> : null}
                    </TableCell>
                    <TableCell><StatusBadge status={ticket.status} /></TableCell>
                    <TableCell><PriorityBadge priority={ticket.priority} /></TableCell>
                    {showSchoolColumn && <TableCell className="text-sm">{ticket.schoolName || ticket.tenantName}</TableCell>}
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center text-slate-500 text-xs gap-1"><Clock className="h-3 w-3" />{format(new Date(ticket.updatedAt), "d MMM yyyy", { locale: es })}</div>
                        {ticket.commentCount > 0 && <div className="flex items-center text-slate-400 text-xs gap-1"><MessageSquare className="h-3 w-3" />{ticket.commentCount}</div>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {ticketsData && ticketsData.totalPages > 1 && (
          <div className="p-4 border-t flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
            <span className="text-sm text-slate-500">Mostrando {(page - 1) * 20 + 1}-{Math.min(page * 20, ticketsData.total)} de {ticketsData.total}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page === ticketsData.totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

