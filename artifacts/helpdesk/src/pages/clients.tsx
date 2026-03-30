import { useState } from "react";
import { useListTenants } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Building2, Users, Ticket } from "lucide-react";
import { format } from "date-fns";

export default function Clients() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data: tenantsData, isLoading } = useListTenants({
    page,
    limit: 20,
    search: search || undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Clients</h1>
          <p className="text-slate-500 mt-1">Manage tenant organizations and client schools.</p>
        </div>
        <Button className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          Add Client
        </Button>
      </div>

      <Card className="p-4 flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Search clients by name, domain, or email..." 
            className="pl-9 w-full max-w-md"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </Card>

      <div className="bg-white dark:bg-slate-900 border rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
            <TableRow>
              <TableHead className="font-semibold">Client Name</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="text-center font-semibold">Users</TableHead>
              <TableHead className="text-center font-semibold">Open Tickets</TableHead>
              <TableHead className="text-center font-semibold">Total Tickets</TableHead>
              <TableHead className="text-right font-semibold">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><div className="h-5 w-48 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-6 w-16 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" /></TableCell>
                  <TableCell><div className="h-5 w-10 bg-slate-100 dark:bg-slate-800 rounded animate-pulse mx-auto" /></TableCell>
                  <TableCell><div className="h-5 w-10 bg-slate-100 dark:bg-slate-800 rounded animate-pulse mx-auto" /></TableCell>
                  <TableCell><div className="h-5 w-10 bg-slate-100 dark:bg-slate-800 rounded animate-pulse mx-auto" /></TableCell>
                  <TableCell><div className="h-5 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : tenantsData?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-48 text-center text-slate-500">
                  No clients found.
                </TableCell>
              </TableRow>
            ) : (
              tenantsData?.data.map((tenant) => (
                <TableRow key={tenant.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">{tenant.name}</div>
                        <div className="text-xs text-slate-500">{tenant.slug}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={tenant.active ? "default" : "secondary"} className={tenant.active ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : ""}>
                      {tenant.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <Users className="h-4 w-4 text-slate-400" />
                      {tenant.totalUsers}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1.5 font-medium text-amber-600 dark:text-amber-500">
                      <Ticket className="h-4 w-4" />
                      {tenant.openTickets}
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-slate-500">
                    {tenant.totalTickets}
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-500">
                    {format(new Date(tenant.createdAt), 'MMM d, yyyy')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {tenantsData && tenantsData.totalPages > 1 && (
          <div className="p-4 border-t flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
            <span className="text-sm text-slate-500">
              Showing {(page - 1) * 20 + 1} to {Math.min(page * 20, tenantsData.total)} of {tenantsData.total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page === tenantsData.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
