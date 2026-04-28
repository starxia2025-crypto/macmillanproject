import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useListTickets, useLogout } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
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
  Cable,
  ClipboardPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { customFetch } from "@workspace/api-client-react";
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
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type ActiveSystemAlert = {
  id: number;
  title: string;
  message: string;
  type: "info" | "warning" | "urgent";
  active: boolean;
  updatedAt: string;
} | null;

type TicketNotification = {
  id: string;
  ticketId: number;
  ticketNumber: string;
  title: string;
  message: string;
  createdAt: string;
  href: string;
  read: boolean;
};

function isShortcutImage(icon: string) {
  const normalizedIcon = icon.trim();
  return normalizedIcon.startsWith("data:image/") || normalizedIcon.startsWith("http://") || normalizedIcon.startsWith("https://");
}

function parseStoredArray(value: string | null) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getLastCreatorNotification(ticket: any) {
  const customFields = ticket?.customFields;
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) {
    return null;
  }

  const notification = customFields.lastCreatorNotification;
  if (!notification || typeof notification !== "object" || Array.isArray(notification)) {
    return null;
  }

  return notification as {
    type?: string;
    commentId?: number | string;
    authorName?: string;
    createdAt?: string;
  };
}

export function MacmillanLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user } = useGetMe();
  const latestSeenTicketIdRef = useRef<number | null>(null);
  const trackedTicketStateRef = useRef<Record<number, { status: string; commentCount: number }>>({});
  const trackedTicketStateInitializedRef = useRef(false);
  const dismissedNotificationIdsRef = useRef<Set<string>>(new Set());
  const shouldWatchNewTickets = user?.role === "superadmin" || user?.role === "tecnico";
  const lastSeenSystemAlertIdRef = useRef<number | null>(null);
  const [notifications, setNotifications] = useState<TicketNotification[]>([]);
  const logout = useLogout({
    mutation: {
      onSuccess: () => setLocation("/"),
    },
  });
  const { data: latestTicketsData } = useListTickets(
    { limit: 100 },
    {
      query: {
        enabled: !!user,
        refetchInterval: 15000,
        refetchIntervalInBackground: true,
      },
    } as any,
  );
  const { data: ownTicketsData } = useQuery({
    queryKey: ["own-ticket-activity", user?.id],
    queryFn: () => customFetch<{ data: any[] }>(`/api/tickets?limit=100&createdById=${user?.id}`, { method: "GET" }),
    enabled: !!user?.id,
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const latestTickets = latestTicketsData?.data ?? [];
  const ownTicketActivity = ownTicketsData?.data ?? [];
  const { data: activeSystemAlert } = useQuery({
    queryKey: ["active-system-alert"],
    queryFn: () => customFetch<ActiveSystemAlert>("/api/system-alert/active", { method: "GET" }),
    enabled: !!user,
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
    retry: 1,
  });

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      trackedTicketStateRef.current = {};
      trackedTicketStateInitializedRef.current = false;
      return;
    }

    const stored = window.localStorage.getItem(`ticket-notifications:${user.id}`);
    setNotifications(parseStoredArray(stored));

    const storedDismissed = window.localStorage.getItem(`ticket-notifications-dismissed:${user.id}`);
    dismissedNotificationIdsRef.current = new Set(parseStoredArray(storedDismissed).map(String));
  }, [shouldWatchNewTickets, user]);

  useEffect(() => {
    if (!user) return;
    window.localStorage.setItem(`ticket-notifications:${user.id}`, JSON.stringify(notifications));
  }, [notifications, user]);

  useEffect(() => {
    if (!user || latestTickets.length === 0) return;

    const newestTicketId = latestTickets[0]?.id ?? null;
    const trackedState = trackedTicketStateRef.current;

    if (shouldWatchNewTickets && newestTicketId !== null) {
      if (latestSeenTicketIdRef.current === null) {
        latestSeenTicketIdRef.current = newestTicketId;
      } else if (newestTicketId > latestSeenTicketIdRef.current) {
        const newTickets = [...latestTickets]
          .filter((ticket) => ticket.id > (latestSeenTicketIdRef.current ?? 0))
          .sort((a, b) => a.id - b.id);

        latestSeenTicketIdRef.current = newestTicketId;

        if (newTickets.length > 0) {
          setNotifications((current) => {
            const next = [...current];

            for (const ticket of newTickets) {
              const notificationId = `ticket-${ticket.id}`;
              if (next.some((item) => item.id === notificationId)) continue;

              next.unshift({
                id: notificationId,
                ticketId: ticket.id,
                ticketNumber: ticket.ticketNumber,
                title: ticket.title,
                message: "Nuevo ticket creado",
                createdAt: ticket.createdAt,
                href: `/tickets/${ticket.id}`,
                read: false,
              });

              toast({
                title: "Ticket nuevo",
                description: `${ticket.ticketNumber}: ${ticket.title}`,
                action: (
                  <ToastAction altText="Abrir ticket" onClick={() => setLocation(`/tickets/${ticket.id}`)}>
                    Abrir
                  </ToastAction>
                ),
              });
            }

            return next.slice(0, 25);
          });
        }
      }
    }

    const ownTickets = ownTicketActivity.length > 0
      ? ownTicketActivity
      : latestTickets.filter((ticket) => ticket.createdById === user.id);
    if (!trackedTicketStateInitializedRef.current) {
      trackedTicketStateRef.current = Object.fromEntries(
        ownTickets.map((ticket) => [
          ticket.id,
          {
            status: ticket.status,
            commentCount: ticket.commentCount ?? 0,
          },
        ]),
      );
      trackedTicketStateInitializedRef.current = true;
      return;
    }

    const creatorNotifications: TicketNotification[] = [];

    for (const ticket of ownTickets) {
      const previous = trackedState[ticket.id];
      const lastCreatorNotification = getLastCreatorNotification(ticket);
      const currentState = {
        status: ticket.status,
        commentCount: ticket.commentCount ?? 0,
      };

      if (lastCreatorNotification?.type === "comment" && lastCreatorNotification.commentId) {
        const notificationId = `ticket-comment-${ticket.id}-${lastCreatorNotification.commentId}`;
        if (!dismissedNotificationIdsRef.current.has(notificationId)) {
          creatorNotifications.push({
            id: notificationId,
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            title: ticket.title,
            message: lastCreatorNotification.authorName
              ? `${lastCreatorNotification.authorName} escribió una nueva nota`
              : "Tu ticket tiene una nueva nota",
            createdAt: lastCreatorNotification.createdAt || ticket.updatedAt,
            href: `/tickets/${ticket.id}`,
            read: false,
          });
        }
      }

      if (!previous) {
        trackedState[ticket.id] = currentState;
        continue;
      }

      if (previous.status !== "resuelto" && ticket.status === "resuelto") {
        creatorNotifications.push({
          id: `ticket-resolved-${ticket.id}-${ticket.updatedAt}`,
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          title: ticket.title,
          message: "Tu ticket ha sido marcado como resuelto",
          createdAt: ticket.updatedAt,
          href: `/tickets/${ticket.id}`,
          read: false,
        });
      }

      if (currentState.commentCount > previous.commentCount) {
        creatorNotifications.push({
          id: `ticket-comment-${ticket.id}-${ticket.updatedAt}`,
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          title: ticket.title,
          message: "Tu ticket tiene una nueva nota",
          createdAt: ticket.updatedAt,
          href: `/tickets/${ticket.id}`,
          read: false,
        });
      }

      trackedState[ticket.id] = currentState;
    }

    if (creatorNotifications.length === 0) return;

    setNotifications((current) => {
      const next = [...current];

      for (const notification of creatorNotifications) {
        if (next.some((item) => item.id === notification.id)) continue;
        next.unshift(notification);
      }

      return next.slice(0, 25);
    });
  }, [latestTickets, ownTicketActivity, setLocation, shouldWatchNewTickets, user]);

  useEffect(() => {
    if (!activeSystemAlert) {
      lastSeenSystemAlertIdRef.current = null;
      return;
    }

    if (lastSeenSystemAlertIdRef.current === null) {
      lastSeenSystemAlertIdRef.current = activeSystemAlert.id;
      return;
    }

    if (activeSystemAlert.id === lastSeenSystemAlertIdRef.current) {
      return;
    }

    lastSeenSystemAlertIdRef.current = activeSystemAlert.id;

    toast({
      title: activeSystemAlert.title,
      description: activeSystemAlert.message,
    });
  }, [activeSystemAlert]);

  if (!user) return <>{children}</>;

  const tenantConfig = user as any;
  const activeSchoolName = (user as any).schoolName || user.tenantName || "Macmillan Iberia";
  const activeSchoolLogo = typeof tenantConfig.tenantLogoUrl === "string" ? tenantConfig.tenantLogoUrl.trim() : "";
  const brandTextColor = tenantConfig.tenantPrimaryColor || "#0f172a";
  const sidebarBackgroundColor = tenantConfig.tenantSidebarBackgroundColor || "#ffffff";
  const sidebarTextColor = tenantConfig.tenantSidebarTextColor || "#0f172a";
  const tenantQuickLinks = Array.isArray(tenantConfig.tenantQuickLinks) ? tenantConfig.tenantQuickLinks : [];
  const navMutedColor = sidebarTextColor === "#ffffff" || sidebarTextColor === "#f8fafc" ? "rgba(255,255,255,0.72)" : "rgba(15,23,42,0.66)";
  const navHoverColor = sidebarTextColor === "#ffffff" || sidebarTextColor === "#f8fafc" ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.08)";
  const navActiveColor = sidebarTextColor === "#ffffff" || sidebarTextColor === "#f8fafc" ? "rgba(255,255,255,0.16)" : "rgba(37,99,235,0.14)";
  const dividerColor = sidebarTextColor === "#ffffff" || sidebarTextColor === "#f8fafc" ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.08)";
  const systemAlertStyles = activeSystemAlert?.type === "urgent"
    ? "border-rose-200 bg-rose-50 text-rose-900"
    : activeSystemAlert?.type === "info"
      ? "border-sky-200 bg-sky-50 text-sky-900"
      : "border-amber-200 bg-amber-50 text-amber-900";
  const unreadNotifications = notifications.filter((item) => !item.read);

  function markNotificationAsRead(notificationId: string) {
    dismissedNotificationIdsRef.current.add(notificationId);
    if (user?.id) {
      window.localStorage.setItem(
        `ticket-notifications-dismissed:${user.id}`,
        JSON.stringify(Array.from(dismissedNotificationIdsRef.current).slice(-100)),
      );
    }

    setNotifications((current) =>
      current.filter((item) => item.id !== notificationId),
    );
  }

  const NotificationsMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-full">
          <Bell className="h-5 w-5" />
          {unreadNotifications.length > 0 && (
            <span className="absolute right-1 top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
              {unreadNotifications.length > 9 ? "9+" : unreadNotifications.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notificaciones sin leer</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {unreadNotifications.length === 0 ? (
          <div className="px-3 py-6 text-sm text-slate-500">No hay notificaciones.</div>
        ) : (
          unreadNotifications.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              className="cursor-pointer items-start py-3"
              onClick={() => {
                markNotificationAsRead(notification.id);
                setLocation(notification.href);
              }}
            >
              <div className="flex w-full gap-3">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{notification.message}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{notification.ticketNumber}: {notification.title}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{new Date(notification.createdAt).toLocaleString("es-ES")}</p>
                </div>
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const navItems = [
    { href: "/dashboard", label: "Estadisticas", icon: LayoutDashboard, roles: ["superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"] },
    { href: "/tickets", label: "Tickets de consulta", icon: Ticket, roles: ["superadmin", "admin_cliente", "tecnico", "usuario_cliente", "visor_cliente"] },
    { href: "/assistance/request", label: "Solicitar asistencia", icon: ClipboardPlus, roles: ["admin_cliente", "manager", "usuario_cliente"] },
    { href: "/assistance/inbox", label: "Bandeja de asistencias", icon: CalendarClock, roles: ["superadmin", "tecnico"] },
    { href: "/mochilas", label: "Consulta de Mochilas", icon: LifeBuoy, roles: ["superadmin", "tecnico"], externalDesktopApp: true },
    { href: "/integrations/apis", label: "APIs externas", icon: Cable, roles: ["superadmin", "tecnico"] },
    { href: "/portal", label: "Centro de ayuda", icon: BookOpen, roles: ["superadmin", "admin_cliente", "manager", "tecnico", "usuario_cliente", "visor_cliente"] },
    { href: "/clients", label: "Colegios", icon: Building2, roles: ["superadmin", "tecnico"] },
    { href: "/users", label: "Usuarios", icon: UsersIcon, roles: ["superadmin", "admin_cliente", "tecnico"] },
    { href: "/audit", label: "Auditoria", icon: ActivitySquare, roles: ["superadmin", "tecnico"] },
    { href: "/settings", label: "Avisos globales", icon: AlertTriangle, roles: ["superadmin", "tecnico"] },
  ].filter((item) => item.roles.includes(user.role));

  const NavLinks = () => (
    <div className="flex w-full flex-col gap-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isExternalAction = item.externalDesktopApp;
        const isActive = !isExternalAction && location.startsWith(item.href);
        const handleNavClick = async () => {
          if (!isExternalAction) return;

          if (!window.desktopBridge?.openMochilasApp) {
            toast({
              title: "Disponible solo en escritorio",
              description: "Consulta de Mochilas se abre desde la app de escritorio del tecnico.",
              variant: "destructive",
            });
            return;
          }

          try {
            await window.desktopBridge.openMochilasApp();
          } catch (error) {
            toast({
              title: "No se pudo abrir Consulta de Mochilas",
              description: error instanceof Error ? error.message : "Intentalo de nuevo.",
              variant: "destructive",
            });
          }
        };

        if (isExternalAction) {
          return (
            <button
              key={item.href}
              type="button"
              className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left transition-all duration-200"
              style={{
                backgroundColor: "transparent",
                color: navMutedColor,
                fontWeight: 500,
              }}
              onClick={() => {
                void handleNavClick();
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.backgroundColor = navHoverColor;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        }

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
    <div className="mb-4 rounded-xl border p-3" style={{ borderColor: dividerColor, backgroundColor: "#ffffff" }}>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "#475569" }}>
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
                className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border transition-transform hover:-translate-y-0.5"
                style={{ borderColor: "rgba(148,163,184,0.35)", backgroundColor: "#ffffff" }}
              >
                {isShortcutImage(shortcut.icon) ? (
                  <img src={shortcut.icon.trim()} alt={shortcut.label} className="h-full w-full p-1 object-contain" />
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

  const SidebarBrand = () => (
    <Link href="/dashboard">
      <span className="flex w-full cursor-pointer items-center gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-transparent">
          {activeSchoolLogo ? (
            <img src={activeSchoolLogo} alt={activeSchoolName} className="h-full w-full object-contain" />
          ) : (
            <LifeBuoy className="h-8 w-8 text-slate-700" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-2xl font-bold leading-tight tracking-tight" style={{ color: brandTextColor }}>{activeSchoolName}</span>
        </span>
      </span>
    </Link>
  );

  return (
    <div className="flex min-h-screen w-full bg-slate-50 dark:bg-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r md:flex" style={{ backgroundColor: sidebarBackgroundColor, borderColor: dividerColor, color: sidebarTextColor }}>
        <div className="flex min-h-24 items-center border-b bg-white px-4 py-4" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
          <SidebarBrand />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-6 pb-32">
          <div className="mb-6 px-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: navMutedColor }}>Menu principal</p>
            <NavLinks />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 border-t p-4" style={{ borderColor: dividerColor, backgroundColor: sidebarBackgroundColor }}>
          {tenantQuickLinks.length > 0 && <ShortcutLinks />}
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
        <div className="sticky top-0 z-20 hidden border-b bg-white/95 px-6 py-3 backdrop-blur md:block">
          <div className="mx-auto flex max-w-6xl items-center justify-end">
            <NotificationsMenu />
          </div>
        </div>
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-white px-4 dark:bg-slate-900 md:hidden">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex w-72 flex-col p-0" style={{ backgroundColor: sidebarBackgroundColor, color: sidebarTextColor }}>
                <div className="flex min-h-24 items-center border-b bg-white px-4 py-4" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
                  <SidebarBrand />
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-6">
                  {tenantQuickLinks.length > 0 && <ShortcutLinks />}
                  <NavLinks />
                </div>
              </SheetContent>
            </Sheet>
            <span className="flex items-center gap-2 text-lg font-bold text-primary">
              <LifeBuoy className="h-5 w-5" />
            </span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationsMenu />
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
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:h-screen md:p-8">
          <div className="mx-auto max-w-6xl space-y-4">
            {activeSystemAlert && (
              <div className={`rounded-2xl border px-4 py-3 shadow-sm ${systemAlertStyles}`}>
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">{activeSystemAlert.title}</p>
                    <p className="text-sm opacity-90">{activeSystemAlert.message}</p>
                  </div>
                </div>
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
