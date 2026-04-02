import { Link, useLocation } from "wouter";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  Ticket,
  BookOpen,
  Users as UsersIcon,
  Building2,
  ActivitySquare,
  Settings,
  LogOut,
  Menu,
  LifeBuoy,
  ExternalLink,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function MacmillanLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user } = useGetMe();
  const logout = useLogout({
    mutation: {
      onSuccess: () => setLocation("/"),
    },
  });

  if (!user) return <>{children}</>;

  const tenantConfig = user as any;
  const activeSchoolName = user.tenantName || "Macmillan Iberia";
  const sidebarBackgroundColor = tenantConfig.tenantSidebarBackgroundColor || "#ffffff";
  const sidebarTextColor = tenantConfig.tenantSidebarTextColor || "#0f172a";
  const tenantQuickLinks = Array.isArray(tenantConfig.tenantQuickLinks) ? tenantConfig.tenantQuickLinks : [];
  const navMutedColor = sidebarTextColor === "#ffffff" || sidebarTextColor === "#f8fafc" ? "rgba(255,255,255,0.72)" : "rgba(15,23,42,0.66)";
  const navHoverColor = sidebarTextColor === "#ffffff" || sidebarTextColor === "#f8fafc" ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.08)";
  const navActiveColor = sidebarTextColor === "#ffffff" || sidebarTextColor === "#f8fafc" ? "rgba(255,255,255,0.16)" : "rgba(37,99,235,0.14)";
  const dividerColor = sidebarTextColor === "#ffffff" || sidebarTextColor === "#f8fafc" ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.08)";
  const tileColor = sidebarTextColor === "#ffffff" || sidebarTextColor === "#f8fafc" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.65)";

  const navItems = [
    { href: "/dashboard", label: "Estadisticas", icon: LayoutDashboard, roles: ["superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"] },
    { href: "/tickets", label: "Tickets de consulta", icon: Ticket, roles: ["superadmin", "admin_cliente", "tecnico", "usuario_cliente", "visor_cliente"] },
    { href: "/portal", label: "Centro de ayuda", icon: BookOpen, roles: ["superadmin", "admin_cliente", "manager", "tecnico", "usuario_cliente", "visor_cliente"] },
    { href: "/clients", label: "Colegios", icon: Building2, roles: ["superadmin", "tecnico"] },
    { href: "/users", label: "Usuarios", icon: UsersIcon, roles: ["superadmin", "admin_cliente", "tecnico", "visor_cliente"] },
    { href: "/audit", label: "Auditoria", icon: ActivitySquare, roles: ["superadmin", "tecnico"] },
  ].filter((item) => item.roles.includes(user.role));

  const NavLinks = () => (
    <div className="flex w-full flex-col gap-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = location.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href}>
            <span
              className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-all duration-200"
              style={{
                backgroundColor: isActive ? navActiveColor : "transparent",
                color: isActive ? sidebarTextColor : navMutedColor,
                fontWeight: isActive ? 600 : 500,
              }}
              onMouseEnter={(event) => {
                if (!isActive) event.currentTarget.style.backgroundColor = navHoverColor;
              }}
              onMouseLeave={(event) => {
                if (!isActive) event.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </span>
          </Link>
        );
      })}
    </div>
  );

  const ShortcutLinks = () => (
    <div className="mb-4 rounded-xl border p-3" style={{ borderColor: dividerColor, backgroundColor: tileColor }}>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: navMutedColor }}>
        Accesos directos
      </p>
      <div className="flex flex-wrap gap-2">
        {tenantQuickLinks.map((shortcut: { label: string; url: string; icon: string }, index: number) => (
          <Tooltip key={`${shortcut.label}-${index}`}>
            <TooltipTrigger asChild>
              <a
                href={shortcut.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-lg border transition-transform hover:-translate-y-0.5"
                style={{ borderColor: dividerColor, backgroundColor: tileColor }}
              >
                {shortcut.icon.startsWith("http") || shortcut.icon.startsWith("data:") ? (
                  <img src={shortcut.icon} alt={shortcut.label} className="h-5 w-5 object-contain" />
                ) : (
                  <span className="text-base" aria-hidden="true">{shortcut.icon}</span>
                )}
                <span className="sr-only">{shortcut.label}</span>
              </a>
            </TooltipTrigger>
            <TooltipContent>
              <div className="flex items-center gap-2">
                <span>{shortcut.label}</span>
                <ExternalLink className="h-3 w-3" />
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen w-full bg-slate-50 dark:bg-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r md:flex" style={{ backgroundColor: sidebarBackgroundColor, borderColor: dividerColor, color: sidebarTextColor }}>
        <div className="flex h-16 items-center border-b px-6" style={{ borderColor: dividerColor }}>
          <Link href="/dashboard">
            <span className="flex cursor-pointer items-center gap-2 text-lg font-bold tracking-tight" style={{ color: sidebarTextColor }}>
              <LifeBuoy className="h-6 w-6" />
              Soporte Macmillan
            </span>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-6 pb-56">
          <div className="mb-6 px-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: navMutedColor }}>Menu principal</p>
            <NavLinks />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 border-t p-4" style={{ borderColor: dividerColor, backgroundColor: sidebarBackgroundColor }}>
          {tenantQuickLinks.length > 0 && <ShortcutLinks />}
          <div className="mb-4 rounded-xl border px-4 py-3" style={{ borderColor: dividerColor, backgroundColor: tileColor }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: navMutedColor }}>Colegio activo</p>
            <p className="mt-1 text-lg font-bold leading-tight" style={{ color: sidebarTextColor }}>{activeSchoolName}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-12 w-full justify-start gap-3 px-2" style={{ color: sidebarTextColor }}>
                <Avatar className="h-8 w-8 rounded-md bg-primary/10 text-primary">
                  <AvatarFallback className="rounded-md">{user.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="flex w-full flex-col items-start truncate text-sm">
                  <span className="w-full truncate font-medium">{user.name}</span>
                  <span className="w-full truncate text-xs" style={{ color: navMutedColor }}>Mi cuenta</span>
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

      <div className="flex min-w-0 flex-1 flex-col md:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-white px-4 dark:bg-slate-900 md:hidden">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex w-72 flex-col p-0" style={{ backgroundColor: sidebarBackgroundColor, color: sidebarTextColor }}>
                <div className="flex h-16 items-center border-b px-6" style={{ borderColor: dividerColor }}>
                  <span className="flex items-center gap-2 text-lg font-bold" style={{ color: sidebarTextColor }}>
                    <LifeBuoy className="h-6 w-6" />
                    Soporte Macmillan
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-6">
                  <div className="mb-5 rounded-xl border px-4 py-3" style={{ borderColor: dividerColor, backgroundColor: tileColor }}>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: navMutedColor }}>Colegio activo</p>
                    <p className="mt-1 text-lg font-bold leading-tight" style={{ color: sidebarTextColor }}>{activeSchoolName}</p>
                  </div>
                  {tenantQuickLinks.length > 0 && <ShortcutLinks />}
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

        <main className="flex-1 overflow-y-auto p-4 md:h-screen md:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
