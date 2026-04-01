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
    { href: "/dashboard", label: "Estadisticas", icon: LayoutDashboard, roles: ["superadmin", "admin_cliente", "manager", "tecnico"] },
    { href: "/tickets", label: "Tickets", icon: Ticket, roles: ["superadmin", "admin_cliente", "tecnico", "usuario_cliente"] },
    { href: "/portal", label: "Portal", icon: BookOpen, roles: ["superadmin", "admin_cliente", "manager", "tecnico", "usuario_cliente", "visor_cliente"] },
    { href: "/admin", label: "Admin", icon: ShieldCheck, roles: ["superadmin", "tecnico", "manager"] },
    { href: "/clients", label: "Clientes", icon: Building2, roles: ["superadmin"] },
    { href: "/users", label: "Usuarios", icon: UsersIcon, roles: ["superadmin", "admin_cliente"] },
    { href: "/audit", label: "Auditoria", icon: ActivitySquare, roles: ["superadmin"] },
  ].filter((item) => item.roles.includes(user.role));

  const NavLinks = () => (
    <div className="flex w-full flex-col gap-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = location.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href}>
            <span
              className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-all duration-200 ${
                isActive
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
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

  const activeSchoolName = user.tenantName || "Macmillan Iberia";

  return (
    <div className="flex min-h-screen w-full bg-slate-50 dark:bg-slate-950">
      <aside className="z-10 hidden w-64 flex-col border-r bg-white dark:bg-slate-900 md:flex">
        <div className="flex h-16 items-center border-b px-6">
          <Link href="/dashboard">
            <span className="flex cursor-pointer items-center gap-2 text-lg font-bold tracking-tight text-primary">
              <LifeBuoy className="h-6 w-6" />
              Soporte Macmillan
            </span>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mb-6 px-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Menu principal</p>
            <NavLinks />
          </div>
        </div>
        <div className="border-t p-4">
          <div className="mb-4 rounded-xl border bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Colegio activo</p>
            <p className="mt-1 text-lg font-bold leading-tight text-slate-900 dark:text-white">{activeSchoolName}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-12 w-full justify-start gap-3 px-2">
                <Avatar className="h-8 w-8 rounded-md bg-primary/10 text-primary">
                  <AvatarFallback className="rounded-md">{user.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="flex w-full flex-col items-start truncate text-sm">
                  <span className="w-full truncate font-medium">{user.name}</span>
                  <span className="w-full truncate text-xs text-slate-500">Mi cuenta</span>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Mi cuenta</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setLocation("/settings")} className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Configuracion
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => logout.mutate()} className="cursor-pointer text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesion
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-white px-4 dark:bg-slate-900 md:hidden">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex w-72 flex-col p-0">
                <div className="flex h-16 items-center border-b px-6">
                  <span className="flex items-center gap-2 text-lg font-bold text-primary">
                    <LifeBuoy className="h-6 w-6" />
                    Soporte Macmillan
                  </span>
                </div>
                <div className="flex-1 px-4 py-6">
                  <div className="mb-5 rounded-xl border bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Colegio activo</p>
                    <p className="mt-1 text-lg font-bold leading-tight text-slate-900 dark:text-white">{activeSchoolName}</p>
                  </div>
                  <NavLinks />
                </div>
              </SheetContent>
            </Sheet>
            <span className="flex items-center gap-2 text-lg font-bold text-primary">
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
                Configuracion
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => logout.mutate()} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesion
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
