import { useState } from "react";
import { useListAuditLogs, useGetMe } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Activity, ShieldAlert } from "lucide-react";

export default function Audit() {
  const { data: user } = useGetMe();
  const [page, setPage] = useState(1);

  const { data: auditData, isLoading } = useListAuditLogs({
    page,
    limit: 50,
    tenantId: user?.role === 'superadmin' ? undefined : user?.tenantId
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-primary" />
            Audit Logs
          </h1>
          <p className="text-slate-500 mt-1">System-wide activity tracking and compliance records.</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
            <TableRow>
              <TableHead className="font-semibold w-[180px]">Timestamp</TableHead>
              <TableHead className="font-semibold">User</TableHead>
              <TableHead className="font-semibold">Action</TableHead>
              <TableHead className="font-semibold">Entity</TableHead>
              <TableHead className="font-semibold">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(10)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><div className="h-4 w-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-48 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                </TableRow>
              ))
            ) : auditData?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-48 text-center text-slate-500">
                  <Activity className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                  No audit logs found.
                </TableCell>
              </TableRow>
            ) : (
              auditData?.data.map((log) => (
                <TableRow key={log.id} className="text-sm">
                  <TableCell className="text-slate-500 whitespace-nowrap">
                    {format(new Date(log.createdAt), 'MMM d, yyyy HH:mm:ss')}
                  </TableCell>
                  <TableCell className="font-medium">
                    {log.userName}
                  </TableCell>
                  <TableCell>
                    <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-xs font-mono uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-300">
                      {log.action}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="capitalize">{log.entityType}</span> 
                    <span className="text-slate-400 ml-1">#{log.entityId}</span>
                  </TableCell>
                  <TableCell className="text-slate-500 max-w-md truncate">
                    {log.newValues ? (
                      <span className="text-xs font-mono">{JSON.stringify(log.newValues).substring(0, 100)}...</span>
                    ) : '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        
        {auditData && auditData.totalPages > 1 && (
          <div className="p-4 border-t flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
            <span className="text-sm text-slate-500">
              Showing {(page - 1) * 50 + 1} to {Math.min(page * 50, auditData.total)} of {auditData.total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page === auditData.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
