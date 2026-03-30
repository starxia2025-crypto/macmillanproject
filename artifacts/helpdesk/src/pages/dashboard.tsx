import { useState } from "react";
import { 
  useGetDashboardStats, 
  useGetTicketsByStatus, 
  useGetTicketsOverTime, 
  useGetRecentActivity,
  useGetMe
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { Ticket, Clock, CheckCircle2, AlertCircle, Building2, Users } from "lucide-react";
import { format } from "date-fns";
import { StatusBadge } from "@/components/badges";

export default function Dashboard() {
  const { data: user } = useGetMe();
  const tenantId = user?.role === 'superadmin' ? undefined : user?.tenantId;
  
  // Hardcode last 30 days for demo
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 30);
  const dateFromStr = dateFrom.toISOString().split('T')[0];
  
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats({ tenantId });
  const { data: statusData } = useGetTicketsByStatus({ tenantId });
  const { data: timeData } = useGetTicketsOverTime({ tenantId, period: "day" });
  const { data: activity } = useGetRecentActivity({ tenantId, limit: 5 });

  const COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#f43f5e', '#ef4444', '#8b5cf6', '#64748b'];

  if (statsLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-slate-200 dark:bg-slate-800 rounded"></div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-32 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="h-96 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
          <div className="h-96 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Dashboard</h1>
        <p className="text-slate-500 mt-1">Overview of your support operations.</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Open Tickets</CardTitle>
            <Ticket className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.openTickets || 0}</div>
            <p className="text-xs text-slate-500 mt-1">
              <span className="text-red-500 font-medium">{stats?.urgentTickets || 0} urgent</span> requiring attention
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Avg Resolution Time</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.avgResolutionHours ? `${stats.avgResolutionHours}h` : 'N/A'}</div>
            <p className="text-xs text-slate-500 mt-1">
              Based on recent resolved tickets
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Resolved Today</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.resolvedTickets || 0}</div>
            <p className="text-xs text-slate-500 mt-1">
              Great work team!
            </p>
          </CardContent>
        </Card>

        {user?.role === 'superadmin' ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">Total Clients</CardTitle>
              <Building2 className="h-4 w-4 text-indigo-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats?.totalTenants || 0}</div>
              <p className="text-xs text-slate-500 mt-1">
                Active organizations
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">New Tickets</CardTitle>
              <AlertCircle className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats?.newTickets || 0}</div>
              <p className="text-xs text-slate-500 mt-1">
                Awaiting initial response
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-7">
        {/* Main Chart */}
        <Card className="md:col-span-4">
          <CardHeader>
            <CardTitle>Ticket Volume</CardTitle>
            <CardDescription>Created vs Resolved over time</CardDescription>
          </CardHeader>
          <CardContent className="px-2">
            <div className="h-[300px] w-full">
              {timeData && timeData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="date" 
                      tick={{fontSize: 12, fill: '#64748b'}} 
                      axisLine={false} 
                      tickLine={false} 
                      tickFormatter={(val) => format(new Date(val), 'MMM d')}
                    />
                    <YAxis tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      labelFormatter={(val) => format(new Date(val), 'MMM d, yyyy')}
                    />
                    <Line type="monotone" dataKey="created" name="Created" stroke="#6366f1" strokeWidth={3} dot={false} activeDot={{r: 6}} />
                    <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{r: 6}} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400">Not enough data to display</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Status Donut */}
        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle>Tickets by Status</CardTitle>
            <CardDescription>Current snapshot of all open tickets</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full flex flex-col items-center justify-center">
              {statusData && statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="count"
                      nameKey="label"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-slate-400">No active tickets</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest updates across your operations</CardDescription>
        </CardHeader>
        <CardContent>
          {activity && activity.length > 0 ? (
            <div className="space-y-6">
              {activity.map((item) => (
                <div key={item.id} className="flex gap-4">
                  <div className="h-2 w-2 mt-2 rounded-full bg-primary shrink-0" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium">
                      <span className="font-bold">{item.userName}</span> {item.action} {item.entityType} 
                      {item.entityTitle && <span className="text-slate-600 dark:text-slate-400"> "{item.entityTitle}"</span>}
                    </p>
                    <div className="flex items-center text-xs text-slate-500 gap-2">
                      <span>{format(new Date(item.createdAt), 'MMM d, h:mm a')}</span>
                      {item.tenantName && (
                        <>
                          <span>•</span>
                          <span>{item.tenantName}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-slate-500">No recent activity</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
