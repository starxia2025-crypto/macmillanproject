import { useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetMe } from "@workspace/api-client-react";
import { useEffect } from "react";

import { MacmillanLayout } from "@/components/layout-macmillan";
import Login from "@/pages/login-macmillan";
import ChangePassword from "@/pages/change-password";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Dashboard from "@/pages/dashboard";
import Tickets from "@/pages/tickets";
import TicketDetail from "@/pages/tickets/detail";
import NewTicket from "@/pages/tickets/new-education";
import Portal from "@/pages/portal-admin";
import Clients from "@/pages/clients-admin";
import Users from "@/pages/users";
import Audit from "@/pages/audit";
import Settings from "@/pages/settings-admin";
import NotFound from "@/pages/not-found";
import { getDefaultRouteForRole } from "@/lib/default-route";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component, roles }: { component: any; roles?: string[] }) {
  const [, setLocation] = useLocation();
  const { data: user, isLoading, isError } = useGetMe();

  useEffect(() => {
    if (!isLoading && (isError || !user)) {
      setLocation("/");
    }
  }, [isLoading, isError, user, setLocation]);

  useEffect(() => {
    if (!isLoading && user && roles && !roles.includes(user.role)) {
      setLocation(getDefaultRouteForRole(user.role));
    }
  }, [isLoading, user, roles, setLocation]);

  useEffect(() => {
    if (!isLoading && user?.mustChangePassword) {
      setLocation("/change-password");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;
  if (user.mustChangePassword) return null;
  if (roles && !roles.includes(user.role)) return null;

  return (
    <MacmillanLayout>
      <Component />
    </MacmillanLayout>
  );
}

function Router() {
  const [location] = useLocation();

  if (location === "/") return <Login />;
  if (location === "/forgot-password") return <ForgotPassword />;
  if (location === "/reset-password") return <ResetPassword />;
  if (location === "/change-password") return <PasswordChangeRoute />;
  if (location === "/dashboard") return <ProtectedRoute component={Dashboard} roles={["superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"]} />;
  if (location === "/tickets/new") return <ProtectedRoute component={NewTicket} roles={["superadmin", "admin_cliente", "tecnico", "usuario_cliente", "visor_cliente"]} />;
  if (location.startsWith("/tickets/") && location !== "/tickets") return <ProtectedRoute component={TicketDetail} roles={["superadmin", "admin_cliente", "tecnico", "usuario_cliente", "visor_cliente"]} />;
  if (location === "/tickets") return <ProtectedRoute component={Tickets} roles={["superadmin", "admin_cliente", "tecnico", "usuario_cliente", "visor_cliente"]} />;
  if (location === "/portal") return <ProtectedRoute component={Portal} />;
  if (location === "/clients") return <ProtectedRoute component={Clients} roles={["superadmin", "tecnico"]} />;
  if (location === "/users") return <ProtectedRoute component={Users} roles={["superadmin", "admin_cliente", "tecnico"]} />;
  if (location === "/audit") return <ProtectedRoute component={Audit} roles={["superadmin", "tecnico"]} />;
  if (location === "/settings") return <ProtectedRoute component={Settings} />;

  return (
    <MacmillanLayout>
      <NotFound />
    </MacmillanLayout>
  );
}

function PasswordChangeRoute() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading, isError } = useGetMe();

  useEffect(() => {
    if (!isLoading && (isError || !user)) {
      setLocation("/");
    }
  }, [isLoading, isError, user, setLocation]);

  useEffect(() => {
    if (!isLoading && user && !user.mustChangePassword) {
      setLocation(getDefaultRouteForRole(user.role));
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user || !user.mustChangePassword) return null;

  return <ChangePassword />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
