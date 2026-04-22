export {};

declare global {
  interface Window {
    desktopBridge?: {
      openMeeUserManager: (email: string) => Promise<{ ok: true }>;
      openMeeResetPassword: (token: string) => Promise<{ ok: true }>;
      openSalesforce: () => Promise<{ ok: true }>;
      searchSalesforceEmail: (email: string) => Promise<{ ok: true }>;
      openMochilasApp: () => Promise<{ ok: true }>;
      openMochilasOrder: (orderId: string) => Promise<{ ok: true }>;
      sendResolvedTicketEmail: (payload: {
        ticketNumber: string;
        title: string;
        description?: string | null;
        status: string;
        priority: string;
        creatorName?: string | null;
        creatorEmail?: string | null;
        schoolName?: string | null;
        tenantName?: string | null;
        resolvedByName?: string | null;
        resolvedAt?: string | null;
      }) => Promise<{ ok: true }>;
    };
  }
}
