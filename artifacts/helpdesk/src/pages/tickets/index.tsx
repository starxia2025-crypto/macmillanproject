import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListTickets, useGetMe } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, PriorityBadge } from "@/components/badges";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Search, Plus, Filter, MessageSquare, Clock } from "lucide-react";
import { motion } from "framer-motion";

export default function Tickets() {
  const [location, setLocation] = useLocation();
  const { data: user } = useGetMe();
  
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const { data: ticketsData, isLoading } = useListTickets({
    page,
    limit: 20,
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    priority: priorityFilter !== "all" ? priorityFilter : undefined,
    tenantId: user?.role === 'superadmin' ? undefined : user?.tenantId
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Tickets</h1>
          <p className="text-slate-500 mt-1">Manage and track support requests.</p>
        </div>
        <Button onClick={() => setLocation("/tickets/new")} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          New Ticket
        </Button>
      </div>

      <Card className="p-4 flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Search tickets by title, ID, or content..." 
            className="pl-9 w-full"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="nuevo">Nuevo</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="en_revision">En Revisión</SelectItem>
              <SelectItem value="en_proceso">En Proceso</SelectItem>
              <SelectItem value="resuelto">Resuelto</SelectItem>
              <SelectItem value="cerrado">Cerrado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="baja">Baja</SelectItem>
              <SelectItem value="media">Media</SelectItem>
              <SelectItem value="alta">Alta</SelectItem>
              <SelectItem value="urgente">Urgente</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon">
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      <div className="bg-white dark:bg-slate-900 border rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
            <TableRow>
              <TableHead className="w-[100px] font-semibold">ID</TableHead>
              <TableHead className="font-semibold">Details</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold">Priority</TableHead>
              {user?.role === 'superadmin' && <TableHead className="font-semibold">Client</TableHead>}
              <TableHead className="text-right font-semibold">Activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><div className="h-5 w-16 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      <div className="h-5 w-64 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
                      <div className="h-4 w-32 bg-slate-50 dark:bg-slate-800 rounded animate-pulse" />
                    </div>
                  </TableCell>
                  <TableCell><div className="h-6 w-20 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" /></TableCell>
                  <TableCell><div className="h-6 w-20 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" /></TableCell>
                  {user?.role === 'superadmin' && <TableCell><div className="h-5 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>}
                  <TableCell><div className="h-5 w-20 bg-slate-100 dark:bg-slate-800 rounded animate-pulse ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : ticketsData?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={user?.role === 'superadmin' ? 6 : 5} className="h-48 text-center text-slate-500">
                  No tickets found matching your criteria.
                </TableCell>
              </TableRow>
            ) : (
              ticketsData?.data.map((ticket, i) => (
                <TableRow 
                  key={ticket.id} 
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  onClick={() => setLocation(`/tickets/${ticket.id}`)}
                >
                  <TableCell className="font-mono text-xs font-medium text-slate-500">
                    #{ticket.ticketNumber}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-slate-900 dark:text-slate-100 mb-1 line-clamp-1">{ticket.title}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-2">
                      <span className="truncate max-w-[200px]">{ticket.category || 'General'}</span>
                      <span>•</span>
                      <span>Assigned: {ticket.assignedToName || 'Unassigned'}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={ticket.status} />
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={ticket.priority} />
                  </TableCell>
                  {user?.role === 'superadmin' && (
                    <TableCell className="text-sm">
                      {ticket.tenantName}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center text-slate-500 text-xs gap-1">
                        <Clock className="h-3 w-3" />
                        {format(new Date(ticket.updatedAt), 'MMM d, yyyy')}
                      </div>
                      {ticket.commentCount > 0 && (
                        <div className="flex items-center text-slate-400 text-xs gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {ticket.commentCount}
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        
        {/* Pagination placeholder */}
        {ticketsData && ticketsData.totalPages > 1 && (
          <div className="p-4 border-t flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
            <span className="text-sm text-slate-500">
              Showing {(page - 1) * 20 + 1} to {Math.min(page * 20, ticketsData.total)} of {ticketsData.total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page === ticketsData.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
