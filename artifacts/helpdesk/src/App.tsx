import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetMe } from "@workspace/api-client-react";
import { useEffect } from "react";

import { Layout } from "@/components/layout";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Tickets from "@/pages/tickets";
import TicketDetail from "@/pages/tickets/detail";
import NewTicket from "@/pages/tickets/new";
import Portal from "@/pages/portal";
import Clients from "@/pages/clients";
import Users from "@/pages/users";
import Audit from "@/pages/audit";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component, roles }: { component: any, roles?: string[] }) {
  const [location, setLocation] = useLocation();
  const { data: user, isLoading, isError } = useGetMe();

  useEffect(() => {
    if (!isLoading && (isError || !user)) {
      setLocation("/");
    }
  }, [isLoading, isError, user, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  if (roles && !roles.includes(user.role)) {
    return <NotFound />;
  }

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Login} />
      
      <Route path="/dashboard">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      
      <Route path="/tickets/new">
        {() => <ProtectedRoute component={NewTicket} roles={['superadmin', 'admin_cliente', 'tecnico', 'usuario_cliente']} />}
      </Route>
      
      <Route path="/tickets/:id">
        {() => <ProtectedRoute component={TicketDetail} roles={['superadmin', 'admin_cliente', 'tecnico', 'usuario_cliente']} />}
      </Route>
      
      <Route path="/tickets">
        {() => <ProtectedRoute component={Tickets} roles={['superadmin', 'admin_cliente', 'tecnico', 'usuario_cliente']} />}
      </Route>
      
      <Route path="/portal">
        {() => <ProtectedRoute component={Portal} />}
      </Route>
      
      <Route path="/clients">
        {() => <ProtectedRoute component={Clients} roles={['superadmin']} />}
      </Route>
      
      <Route path="/users">
        {() => <ProtectedRoute component={Users} roles={['superadmin', 'admin_cliente']} />}
      </Route>
      
      <Route path="/audit">
        {() => <ProtectedRoute component={Audit} roles={['superadmin', 'admin_cliente']} />}
      </Route>
      
      <Route path="/settings">
        {() => <ProtectedRoute component={Settings} />}
      </Route>
      
      <Route>
        <Layout>
          <NotFound />
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
