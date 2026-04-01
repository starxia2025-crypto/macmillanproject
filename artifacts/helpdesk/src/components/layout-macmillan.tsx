import { Link, useLocation } from "wouter";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  Ticket,
  BookOpen,
  Users as UsersIcon,
  Building2,
  ActivitySquare,
  ShieldCheck,
  Settings,
  LogOut,
  Menu,
  LifeBuoy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function MacmillanLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user } = useGetMe();
  const logout = useLogout({
    mutation: {
      onSuccess: () => setLocation("/"),
    },
  });

  if (!user) return <>{children}</>;

  const navItems = [
    { href: "/dashboard", label: "Estadísticas", icon: LayoutDashboard, roles: ["superadmin", "admin_cliente", "manager", "tecnico"] },
    { href: "/tickets", label: "Tickets", icon: Ticket, roles: ["superadmin", "admin_cliente", "tecnico", "usuario_cliente"] },
    { href: "/portal", label: "Portal", icon: BookOpen, roles: ["superadmin", "admin_cliente", "manager", "tecnico", "usuario_cliente", "visor_cliente"] },
    { href: "/admin", label: "Admin", icon: ShieldCheck, roles: ["superadmin", "tecnico", "manager"] },
    { href: "/clients", label: "Clientes", icon: Building2, roles: ["superadmin", "admin_cliente", "tecnico", "manager"] },
    { href: "/users", label: "Usuarios", icon: UsersIcon, roles: ["superadmin", "admin_cliente"] },
    { href: "/audit", label: "Auditoría", icon: ActivitySquare, roles: ["superadmin", "admin_cliente", "manager"] },
  ].filter((item) => item.roles.includes(user.role));

  const NavLinks = () => (
    <div className="flex flex-col gap-1 w-full">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = location.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href}>
            <span
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 cursor-pointer ${
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </span>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="flex min-h-screen w-full bg-slate-50 dark:bg-slate-950">
      <aside className="hidden md:flex flex-col w-64 border-r bg-white dark:bg-slate-900 z-10">
        <div className="h-16 flex items-center px-6 border-b">
          <Link href="/dashboard">
            <span className="flex items-center gap-2 font-bold text-lg text-primary cursor-pointer tracking-tight">
              <LifeBuoy className="h-6 w-6" />
              Soporte Macmillan
            </span>
          </Link>
        </div>
        <div className="flex-1 py-6 px-4 overflow-y-auto">
          <div className="mb-6 px-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Menú principal</p>
            <NavLinks />
          </div>
        </div>
        <div className="p-4 border-t">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-3 px-2 h-12">
                <Avatar className="h-8 w-8 rounded-md bg-primary/10 text-primary">
                  <AvatarFallback className="rounded-md">{user.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start text-sm truncate">
                  <span className="font-medium truncate w-full">{user.name}</span>
                  <span className="text-xs text-slate-500 truncate w-full">{user.tenantName || "Sistema"}</span>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Mi cuenta</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setLocation("/settings")} className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Configuración
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => logout.mutate()} className="cursor-pointer text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <div className="flex flex-col flex-1 min-w-0">
        <header className="h-16 flex items-center justify-between px-4 border-b bg-white dark:bg-slate-900 md:hidden sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0 flex flex-col">
                <div className="h-16 flex items-center px-6 border-b">
                  <span className="flex items-center gap-2 font-bold text-lg text-primary">
                    <LifeBuoy className="h-6 w-6" />
                    Soporte Macmillan
                  </span>
                </div>
                <div className="flex-1 py-6 px-4">
                  <NavLinks />
                </div>
              </SheetContent>
            </Sheet>
            <span className="font-bold text-lg text-primary flex items-center gap-2">
              <LifeBuoy className="h-5 w-5" />
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Mi cuenta</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setLocation("/settings")}>
                <Settings className="mr-2 h-4 w-4" />
                Configuración
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => logout.mutate()} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
