const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  openMeeUserManager: (email) => ipcRenderer.invoke("mee-admin:open-user-manager", { email }),
  openMeeResetPassword: (token) => ipcRenderer.invoke("mee-admin:open-reset-password", { token }),
  openSalesforce: () => ipcRenderer.invoke("salesforce:open"),
  searchSalesforceEmail: (email) => ipcRenderer.invoke("salesforce:search-email", { email }),
  openMochilasApp: () => ipcRenderer.invoke("mochilas-app:open"),
  openMochilasOrder: (orderId) => ipcRenderer.invoke("mochilas-app:open-order", { orderId }),
  sendResolvedTicketEmail: (payload) => ipcRenderer.invoke("outlook:send-ticket-resolved-email", payload),
});
