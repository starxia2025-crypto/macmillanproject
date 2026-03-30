import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { 
  useGetTicket, 
  useListTicketComments, 
  useAddTicketComment,
  useChangeTicketStatus,
  useAssignTicket,
  useGetMe,
  TicketStatus
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Send, Clock, User, Building, Paperclip, Lock, LockOpen } from "lucide-react";
import { format } from "date-fns";
import { StatusBadge, PriorityBadge } from "@/components/badges";
import { Separator } from "@/components/ui/separator";

export default function TicketDetail() {
  const [location, setLocation] = useLocation();
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  
  const { data: user } = useGetMe();
  const { data: ticket, isLoading: ticketLoading } = useGetTicket(id);
  const { data: comments, refetch: refetchComments } = useListTicketComments(id);
  
  const [commentText, setCommentText] = useState("");
  const [isInternal, setIsInternal] = useState(false);

  const addComment = useAddTicketComment({
    mutation: {
      onSuccess: () => {
        setCommentText("");
        refetchComments();
      }
    }
  });

  const changeStatus = useChangeTicketStatus({
    mutation: {
      onSuccess: () => {
        // Option to invalidate query or just let it be
      }
    }
  });

  const isStaff = user?.role === 'superadmin' || user?.role === 'tecnico';

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

  if (!ticket) return <div>Ticket not found</div>;

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

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Button variant="ghost" onClick={() => setLocation("/tickets")} className="gap-2 -ml-4 text-slate-500">
        <ArrowLeft className="h-4 w-4" />
        Back to Tickets
      </Button>

      {/* Header Card */}
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
                {ticket.title}
              </h1>
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500 mt-2">
                <span className="flex items-center gap-1.5"><User className="h-4 w-4" /> {ticket.createdByName}</span>
                <span className="flex items-center gap-1.5"><Building className="h-4 w-4" /> {ticket.tenantName}</span>
                <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> {format(new Date(ticket.createdAt), 'MMM d, yyyy h:mm a')}</span>
              </div>
            </div>

            {/* Actions */}
            {isStaff && (
              <div className="flex flex-col sm:flex-row gap-3 md:min-w-[200px] shrink-0">
                <Select value={ticket.status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="font-medium">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TicketStatus.nuevo}>Nuevo</SelectItem>
                    <SelectItem value={TicketStatus.pendiente}>Pendiente</SelectItem>
                    <SelectItem value={TicketStatus.en_revision}>En Revisión</SelectItem>
                    <SelectItem value={TicketStatus.en_proceso}>En Proceso</SelectItem>
                    <SelectItem value={TicketStatus.esperando_cliente}>Esperando Cliente</SelectItem>
                    <SelectItem value={TicketStatus.resuelto}>Resuelto</SelectItem>
                    <SelectItem value={TicketStatus.cerrado}>Cerrado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardHeader>
      </Card>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Main Conversation Thread */}
        <div className="md:col-span-2 space-y-6">
          {/* Original Description */}
          <Card className="shadow-sm">
            <CardContent className="pt-6">
              <div className="prose dark:prose-invert max-w-none whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                {ticket.description}
              </div>
            </CardContent>
          </Card>

          {/* Comments List */}
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
                      {comment.authorName.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold text-sm flex items-center gap-2">
                        {comment.authorName}
                        {comment.isInternal && (
                          <span className="text-[10px] uppercase font-bold tracking-wider bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Lock className="h-3 w-3" /> Internal
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">{format(new Date(comment.createdAt), 'MMM d, h:mm a')}</div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                  <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                    {comment.content}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* New Comment Box */}
          <Card className={`shadow-sm border-2 ${isInternal ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50/20' : 'border-primary/20 focus-within:border-primary'}`}>
            <CardContent className="p-4">
              <Textarea 
                placeholder={isInternal ? "Write an internal note (clients won't see this)..." : "Write a response..."}
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
                      Internal Note
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="gap-2 text-slate-500">
                    <Paperclip className="h-4 w-4" />
                    Attach
                  </Button>
                </div>
                <Button 
                  onClick={handlePostComment} 
                  disabled={!commentText.trim() || addComment.isPending}
                  className={`gap-2 ${isInternal ? 'bg-amber-600 hover:bg-amber-700' : ''}`}
                >
                  <Send className="h-4 w-4" />
                  {isInternal ? 'Save Note' : 'Send Reply'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="p-4 pb-2">
              <h3 className="font-semibold text-sm uppercase tracking-wider text-slate-500">Properties</h3>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div>
                <div className="text-xs text-slate-500 mb-1">Category</div>
                <div className="font-medium text-sm capitalize">{ticket.category || 'None'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Assigned To</div>
                <div className="font-medium text-sm">{ticket.assignedToName || 'Unassigned'}</div>
              </div>
              {ticket.customFields && Object.keys(ticket.customFields).length > 0 && (
                <>
                  <Separator />
                  {Object.entries(ticket.customFields).map(([key, val]) => (
                    <div key={key}>
                      <div className="text-xs text-slate-500 mb-1 capitalize">{key.replace(/_/g, ' ')}</div>
                      <div className="font-medium text-sm">{String(val)}</div>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>

          {isStaff && ticket.auditLogs && ticket.auditLogs.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="p-4 pb-2">
                <h3 className="font-semibold text-sm uppercase tracking-wider text-slate-500">History</h3>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="space-y-4">
                  {ticket.auditLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex gap-3 text-sm">
                      <div className="h-2 w-2 mt-1.5 rounded-full bg-slate-300 shrink-0" />
                      <div>
                        <span className="font-medium">{log.userName}</span> {log.action}
                        <div className="text-xs text-slate-500 mt-0.5">
                          {format(new Date(log.createdAt), 'MMM d, h:mm a')}
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
    </div>
  );
}
