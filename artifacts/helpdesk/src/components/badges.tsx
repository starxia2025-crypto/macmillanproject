import { Badge } from "@/components/ui/badge";
import { TicketStatus, TicketPriority } from "@workspace/api-client-react";

export function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { bg: string, text: string, label: string }> = {
    [TicketStatus.nuevo]: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", label: "Nuevo" },
    [TicketStatus.pendiente]: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-400", label: "Pendiente" },
    [TicketStatus.en_revision]: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-800 dark:text-orange-400", label: "En Revisión" },
    [TicketStatus.en_proceso]: { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-400", label: "En Proceso" },
    [TicketStatus.esperando_cliente]: { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-800 dark:text-amber-400", label: "Esperando Cliente" },
    [TicketStatus.resuelto]: { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400", label: "Resuelto" },
    [TicketStatus.cerrado]: { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-600 dark:text-slate-400", label: "Cerrado" },
  };

  const v = variants[status as TicketStatus] || { bg: "bg-slate-100", text: "text-slate-700", label: status };

  return (
    <Badge variant="outline" className={`${v.bg} ${v.text} border-transparent font-medium shadow-none`}>
      {v.label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const variants: Record<string, { bg: string, text: string, label: string }> = {
    [TicketPriority.baja]: { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-600 dark:text-slate-400", label: "Baja" },
    [TicketPriority.media]: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", label: "Media" },
    [TicketPriority.alta]: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-800 dark:text-orange-400", label: "Alta" },
    [TicketPriority.urgente]: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-400", label: "Urgente" },
  };

  const v = variants[priority as TicketPriority] || { bg: "bg-slate-100", text: "text-slate-700", label: priority };

  return (
    <Badge variant="outline" className={`${v.bg} ${v.text} border-transparent font-medium shadow-none`}>
      {v.label}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: string }) {
  const variants: Record<string, { bg: string, text: string, label: string }> = {
    superadmin: { bg: "bg-indigo-100 dark:bg-indigo-900/30", text: "text-indigo-700 dark:text-indigo-400", label: "Super Admin" },
    admin_cliente: { bg: "bg-violet-100 dark:bg-violet-900/30", text: "text-violet-700 dark:text-violet-400", label: "Admin Cliente" },
    tecnico: { bg: "bg-teal-100 dark:bg-teal-900/30", text: "text-teal-700 dark:text-teal-400", label: "Técnico" },
    usuario_cliente: { bg: "bg-sky-100 dark:bg-sky-900/30", text: "text-sky-700 dark:text-sky-400", label: "Usuario" },
    visor_cliente: { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-600 dark:text-slate-400", label: "Visor" },
  };

  const v = variants[role] || { bg: "bg-slate-100", text: "text-slate-700", label: role };

  return (
    <Badge variant="outline" className={`${v.bg} ${v.text} border-transparent font-medium shadow-none`}>
      {v.label}
    </Badge>
  );
}
