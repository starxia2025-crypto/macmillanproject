import { useState } from "react";
import { useListUsers, useGetMe } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Filter } from "lucide-react";
import { format } from "date-fns";
import { RoleBadge } from "@/components/badges";

export default function Users() {
  const { data: currentUser } = useGetMe();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const { data: usersData, isLoading } = useListUsers({
    page,
    limit: 20,
    search: search || undefined,
    role: roleFilter !== "all" ? roleFilter : undefined,
    tenantId: currentUser?.role === 'superadmin' ? undefined : currentUser?.tenantId
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Users</h1>
          <p className="text-slate-500 mt-1">Manage system access and roles.</p>
        </div>
        <Button className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          Add User
        </Button>
      </div>

      <Card className="p-4 flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Search users by name or email..." 
            className="pl-9 w-full"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {currentUser?.role === 'superadmin' && <SelectItem value="superadmin">Super Admin</SelectItem>}
              <SelectItem value="admin_cliente">Admin Cliente</SelectItem>
              {currentUser?.role === 'superadmin' && <SelectItem value="tecnico">Técnico</SelectItem>}
              <SelectItem value="usuario_cliente">Usuario</SelectItem>
              <SelectItem value="visor_cliente">Visor</SelectItem>
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
              <TableHead className="font-semibold">User</TableHead>
              <TableHead className="font-semibold">Role</TableHead>
              {currentUser?.role === 'superadmin' && <TableHead className="font-semibold">Client</TableHead>}
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="text-right font-semibold">Last Login</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
                      <div className="space-y-1">
                        <div className="h-4 w-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
                        <div className="h-3 w-48 bg-slate-50 dark:bg-slate-800/50 rounded animate-pulse" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><div className="h-6 w-24 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" /></TableCell>
                  {currentUser?.role === 'superadmin' && <TableCell><div className="h-5 w-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></TableCell>}
                  <TableCell><div className="h-6 w-16 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" /></TableCell>
                  <TableCell><div className="h-5 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : usersData?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={currentUser?.role === 'superadmin' ? 5 : 4} className="h-48 text-center text-slate-500">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              usersData?.data.map((user) => (
                <TableRow key={user.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium flex items-center justify-center text-sm shrink-0 border border-slate-200 dark:border-slate-700 shadow-sm">
                        {user.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">{user.name}</div>
                        <div className="text-xs text-slate-500">{user.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={user.role} />
                  </TableCell>
                  {currentUser?.role === 'superadmin' && (
                    <TableCell className="text-slate-600 dark:text-slate-400 text-sm">
                      {user.tenantName || <span className="text-slate-400 italic">System</span>}
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge variant={user.active ? "default" : "secondary"} className={user.active ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 border-transparent shadow-none" : "shadow-none"}>
                      {user.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-500">
                    {user.lastLoginAt ? format(new Date(user.lastLoginAt), 'MMM d, yyyy') : 'Never'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {usersData && usersData.totalPages > 1 && (
          <div className="p-4 border-t flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
            <span className="text-sm text-slate-500">
              Showing {(page - 1) * 20 + 1} to {Math.min(page * 20, usersData.total)} of {usersData.total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page === usersData.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
