const { app, BrowserWindow, dialog, shell, ipcMain, clipboard } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

const BACKEND_PORT = Number(process.env.HELPDESK_DESKTOP_PORT || 3002);
const BACKEND_HOST = "localhost";
const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
const START_TIMEOUT_MS = 45000;
const DEFAULT_MEE_ADMIN_URL = "https://mee-admin.springernature.com/console";
const DEFAULT_SALESFORCE_URL = "https://macmillaneducation.my.salesforce.com/";
const REQUIRED_MYSQL_ENV = [
  "MYSQL_HOST",
  "MYSQL_DATABASE",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
];

let backendProcess = null;
let mainWindow = null;
let meeAdminWindow = null;
let salesforceWindow = null;
let salesforceSearchInterval = null;
let pendingMeeEmail = null;
let pendingMeeAutomation = null;
let meeAdminAutofillInterval = null;

app.setName("Soporte Macmillan");
app.setAppUserModelId("com.macmillan.helpdesk");
app.setPath("userData", path.join(app.getPath("appData"), "Soporte Macmillan"));

function resolveMochilasDesktopExe() {
  const desktopEnv = loadDesktopEnv();
  const configuredExe = desktopEnv.MOCHILAS_DESKTOP_EXE || process.env.MOCHILAS_DESKTOP_EXE;
  if (configuredExe) {
    return configuredExe;
  }

  return path.join(
    process.env.LOCALAPPDATA || "",
    "Programs",
    "Mochilas Macmillan",
    "Mochilas Macmillan.exe",
  );
}

function escapePowerShellSingleQuoted(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function escapePowerShellDoubleQuoted(value) {
  return String(value ?? "").replace(/`/g, "``").replace(/"/g, '`"').replace(/\$/g, "`$");
}

function buildResolvedTicketEmailBody(payload) {
  return [
    `Ticket: ${payload.ticketNumber || "-"}`,
    `Asunto: ${payload.title || "-"}`,
    `Estado: ${payload.status || "-"}`,
    `Prioridad: ${payload.priority || "-"}`,
    `Colegio: ${payload.schoolName || "-"}`,
    `Red educativa: ${payload.tenantName || "-"}`,
    `Creador: ${payload.creatorName || "-"}`,
    `Email creador: ${payload.creatorEmail || "-"}`,
    `Resuelto por: ${payload.resolvedByName || "-"}`,
    `Fecha de resolucion: ${payload.resolvedAt || new Date().toLocaleString("es-ES")}`,
    "",
    "Descripcion:",
    payload.description || "-",
  ].join("\r\n");
}

function sendResolvedTicketEmailWithOutlook(payload) {
  return new Promise((resolve, reject) => {
    const desktopEnv = loadDesktopEnv();
    const recipient =
      desktopEnv.TICKET_RESOLVED_NOTIFY_TO ||
      process.env.TICKET_RESOLVED_NOTIFY_TO ||
      "javier.alexander@macmillaneducation.com";
    const subject = `[Ticket resuelto] ${payload.ticketNumber || "-"} - ${payload.title || "-"}`;
    const body = buildResolvedTicketEmailBody(payload);
    const script = `
$ErrorActionPreference = 'Stop'
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.To = '${escapePowerShellSingleQuoted(recipient)}'
$mail.Subject = '${escapePowerShellSingleQuoted(subject)}'
$mail.Body = @'
${body}
'@
$mail.Send()
`;
    const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedCommand,
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }

      reject(new Error(stderr.trim() || `Outlook envio codigo ${code}`));
    });
  });
}

function focusMochilasAndSearchOrder(orderId) {
  return new Promise((resolve) => {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
Start-Sleep -Milliseconds 1200
$wshell = New-Object -ComObject WScript.Shell
$null = $wshell.AppActivate('Mochilas')
Start-Sleep -Milliseconds 350
$wshell.SendKeys('^a')
Start-Sleep -Milliseconds 100
$wshell.SendKeys("${escapePowerShellDoubleQuoted(orderId)}")
Start-Sleep -Milliseconds 100
$wshell.SendKeys('{ENTER}')
`;
    const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedCommand,
    ], {
      windowsHide: true,
      stdio: "ignore",
    });

    child.on("error", () => resolve({ ok: false }));
    child.on("exit", () => resolve({ ok: true }));
  });
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const content = fs.readFileSync(filePath, "utf8");
  const parsed = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function loadDesktopEnv() {
  const candidates = app.isPackaged
    ? [
        path.join(path.dirname(process.execPath), ".env.local"),
        path.join(process.resourcesPath, ".env.local"),
      ]
    : [
        path.resolve(__dirname, "..", ".env.local"),
        path.resolve(__dirname, "..", ".env"),
      ];

  const merged = {};
  for (const filePath of candidates) {
    Object.assign(merged, parseEnvFile(filePath));
  }

  return merged;
}

function resolveAppBaseDir() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, "..");
}

function resolveRuntimeCwd() {
  return app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..");
}

function resolveBackendEntry() {
  return path.join(resolveAppBaseDir(), "artifacts", "api-server", "dist", "index.mjs");
}

function resolveStaticDir() {
  return path.join(resolveAppBaseDir(), "artifacts", "helpdesk", "dist", "public");
}

function resolveWindowIcon() {
  return path.join(resolveAppBaseDir(), "desktop", "assets", "logo-mee-black-mac.ico");
}

function waitForServer(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const tryConnect = () => {
      const req = http.get(`${url}/api/healthz`, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("No se pudo arrancar el servidor local a tiempo."));
          return;
        }
        setTimeout(tryConnect, 600);
      });
    };

    tryConnect();
  });
}

function startBackend() {
  const backendEntry = resolveBackendEntry();
  const staticDir = resolveStaticDir();
  const runtimeCwd = resolveRuntimeCwd();
  const desktopEnv = loadDesktopEnv();
  const logDir = app.getPath("userData");
  const backendLogPath = path.join(logDir, "backend.log");
  const databaseUrl = desktopEnv.DATABASE_URL ?? process.env.DATABASE_URL;
  const missingEnv = databaseUrl && String(databaseUrl).trim()
    ? []
    : REQUIRED_MYSQL_ENV.filter((key) => {
        const value = desktopEnv[key] ?? process.env[key];
        return !value || !String(value).trim();
      });

  if (!fs.existsSync(backendEntry)) {
    throw new Error(`No se encuentra el backend compilado: ${backendEntry}`);
  }

  if (!fs.existsSync(staticDir)) {
    throw new Error(`No se encuentra el frontend compilado: ${staticDir}`);
  }

  if (!fs.existsSync(runtimeCwd)) {
    throw new Error(`No se encuentra el directorio de ejecucion: ${runtimeCwd}`);
  }

  if (missingEnv.length > 0) {
    throw new Error(`Falta configuracion en .env.local. Variables requeridas: ${missingEnv.join(", ")}.`);
  }

  const env = {
    ...desktopEnv,
    ...process.env,
    PORT: String(BACKEND_PORT),
    NODE_ENV: "production",
    STATIC_DIR: staticDir,
    BASE_PATH: "/",
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" "),
    SESSION_SECRET:
      process.env.SESSION_SECRET ||
      desktopEnv.SESSION_SECRET ||
      crypto.randomBytes(24).toString("hex"),
    ELECTRON_RUN_AS_NODE: "1",
    DESKTOP_USE_OUTLOOK_EMAIL: "1",
  };

  fs.mkdirSync(logDir, { recursive: true });
  const backendLogFd = fs.openSync(backendLogPath, "a");

  backendProcess = spawn(process.execPath, [backendEntry], {
    env,
    cwd: runtimeCwd,
    windowsHide: true,
    stdio: ["ignore", backendLogFd, backendLogFd],
  });

  backendProcess.on("exit", (code) => {
    if (!app.isQuitting) {
      dialog.showErrorBox(
        "Soporte Macmillan",
        `El servidor local se ha cerrado inesperadamente (codigo ${code ?? "desconocido"}).`,
      );
      app.quit();
    }
  });
}

function createMeeUserManagerAutomationScript(email, runId = "") {
  return `
    (() => {
      const targetEmail = ${JSON.stringify(email)};
      const stateKey = "mee-user-manager-state:" + ${JSON.stringify(runId)} + ":" + targetEmail.toLowerCase();
      const normalize = (value) => (value || "").toLowerCase().replace(/\\s+/g, " ").trim();
      const currentState = window.sessionStorage.getItem(stateKey) || "start";
      const isAuthPage = [
        "login.microsoftonline.com",
        "okta",
        "signin",
        "login"
      ].some((part) => normalize(window.location.href).includes(part));

      if (isAuthPage) {
        return { ok: true, action: "login-required" };
      }

      const textMatches = (element, text) => normalize(element?.textContent || element?.value).includes(normalize(text));
      const exactTextMatches = (element, text) => normalize(element?.textContent || element?.value) === normalize(text);
      const pageText = normalize(document.body?.innerText || "");
      const hasNoResults = pageText.includes("no results") || pageText.includes("broaden your criteria");

      if (currentState === "searched" && hasNoResults) {
        window.sessionStorage.setItem(stateKey, "no-results");
        return { ok: true, action: "no-results" };
      }

      if (currentState === "no-results" || currentState === "edit-profile-opened") {
        return { ok: true, action: currentState };
      }

      const findByText = (selector, text) =>
        Array.from(document.querySelectorAll(selector)).find((element) => textMatches(element, text)) || null;

      const findEmailInput = () => {
        const inputs = Array.from(document.querySelectorAll("input"));
        for (const input of inputs) {
          const placeholder = normalize(input.getAttribute("placeholder"));
          const name = normalize(input.getAttribute("name"));
          const id = normalize(input.getAttribute("id"));
          const type = normalize(input.getAttribute("type"));

          if (
            placeholder.includes("email") ||
            name.includes("email") ||
            id.includes("email") ||
            type === "email"
          ) {
            return input;
          }
        }

        const labels = Array.from(document.querySelectorAll("label"));
        for (const label of labels) {
          if (normalize(label.textContent).includes("email")) {
            const forId = label.getAttribute("for");
            if (forId) {
              const linked = document.getElementById(forId);
              if (linked && linked.tagName === "INPUT") return linked;
            }
            const nested = label.querySelector("input");
            if (nested) return nested;
          }
        }

        return null;
      };

      const clickUserManager = () => {
        const trigger = findByText("a, button, [role='menuitem'], [role='button']", "User Manager");
        if (!trigger) return false;
        trigger.click();
        window.sessionStorage.setItem(stateKey, "user-manager");
        return true;
      };

      const fillAndSearch = () => {
        const input = findEmailInput();
        if (!input) return false;

        input.focus();
        input.value = targetEmail;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

        const searchButton =
          findByText("button, input[type='submit'], input[type='button']", "Search") ||
          findByText("button, input[type='submit'], input[type='button']", "Buscar");

        if (searchButton) {
          searchButton.click();
          window.sessionStorage.setItem(stateKey, "searched");
          return true;
        }

        return false;
      };

      const openMatchingUser = () => {
        const rows = Array.from(document.querySelectorAll("tr"));
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll("td"));
          if (cells.length === 0) continue;

          const usernameCell = cells[0];
          if (!usernameCell) continue;

          const usernameCandidate =
            usernameCell.querySelector("a, button, span, div, strong") ||
            usernameCell;

          if (!exactTextMatches(usernameCandidate, targetEmail)) {
            continue;
          }

          const clickable =
            usernameCell.querySelector("a, button") ||
            usernameCell;

          clickable.scrollIntoView({ block: "center", behavior: "instant" });
          clickable.click();
          window.sessionStorage.setItem(stateKey, "user-opened");
          return true;
        }

        const standaloneUsername = Array.from(document.querySelectorAll("a, button, span, div"))
          .find((element) => exactTextMatches(element, targetEmail));

        if (!standaloneUsername) return false;

        standaloneUsername.scrollIntoView({ block: "center", behavior: "instant" });
        standaloneUsername.click();
        window.sessionStorage.setItem(stateKey, "user-opened");
        return true;
      };

      const clickEditProfile = () => {
        const editButton = findByText("a, button, [role='button']", "Edit profile");
        if (!editButton) return false;
        editButton.scrollIntoView({ block: "center", behavior: "instant" });
        editButton.click();
        window.sessionStorage.setItem(stateKey, "edit-profile-opened");
        return true;
      };

      if ((currentState === "searched" || currentState === "user-opened") && clickEditProfile()) {
        return { ok: true, action: "edit-profile-opened" };
      }

      if ((currentState === "searched" || currentState === "user-opened") && openMatchingUser()) {
        return { ok: true, action: "opened-user" };
      }

      if (currentState === "searched") {
        return { ok: false, action: "waiting-results" };
      }

      if ((currentState === "start" || currentState === "user-manager") && fillAndSearch()) {
        return { ok: true, action: "searched-email" };
      }

      if ((currentState === "start" || currentState === "user-manager") && clickUserManager()) {
        return { ok: true, action: "clicked-user-manager" };
      }

      if (clickEditProfile()) {
        return { ok: true, action: "edit-profile-opened" };
      }

      if (openMatchingUser()) {
        return { ok: true, action: "opened-user" };
      }

      if ((currentState === "start" || currentState === "user-manager") && fillAndSearch()) {
        return { ok: true, action: "searched-email" };
      }

      return { ok: false, action: "waiting-dom" };
    })();
  `;
}

function createMeeResetPasswordAutomationScript(token, runId = "") {
  return `
    (() => {
      const targetToken = ${JSON.stringify(token)};
      const stateKey = "mee-reset-password-state:" + ${JSON.stringify(runId)} + ":" + targetToken.toLowerCase();
      const normalize = (value) => (value || "").toLowerCase().replace(/\\s+/g, " ").trim();
      const currentState = window.sessionStorage.getItem(stateKey) || "start";
      const isAuthPage = [
        "login.microsoftonline.com",
        "okta",
        "signin",
        "login"
      ].some((part) => normalize(window.location.href).includes(part));

      if (isAuthPage) {
        return { ok: true, action: "login-required" };
      }

      const textMatches = (element, text) => normalize(element?.textContent || element?.value).includes(normalize(text));
      const pageText = normalize(document.body?.innerText || "");
      const hasNoResults = pageText.includes("no results") || pageText.includes("broaden your criteria");

      if (currentState === "searched" && hasNoResults) {
        window.sessionStorage.setItem(stateKey, "no-results");
        return { ok: true, action: "no-results" };
      }

      if (currentState === "no-results" || currentState === "reset-password-opened") {
        return { ok: true, action: currentState };
      }

      const findByText = (selector, text) =>
        Array.from(document.querySelectorAll(selector)).find((element) => textMatches(element, text)) || null;

      const findTokenInput = () => {
        const inputs = Array.from(document.querySelectorAll("input"));
        for (const input of inputs) {
          const placeholder = normalize(input.getAttribute("placeholder"));
          const name = normalize(input.getAttribute("name"));
          const id = normalize(input.getAttribute("id"));

          if (
            placeholder.includes("token") ||
            name.includes("token") ||
            id.includes("token") ||
            placeholder.includes("access code") ||
            name.includes("access") ||
            id.includes("access")
          ) {
            return input;
          }
        }

        const labels = Array.from(document.querySelectorAll("label"));
        for (const label of labels) {
          const labelText = normalize(label.textContent);
          if (labelText.includes("token") || labelText.includes("access code")) {
            const forId = label.getAttribute("for");
            if (forId) {
              const linked = document.getElementById(forId);
              if (linked && linked.tagName === "INPUT") return linked;
            }
            const nested = label.querySelector("input");
            if (nested) return nested;
          }
        }

        return null;
      };

      const clickUserManager = () => {
        const trigger = findByText("a, button, [role='menuitem'], [role='button']", "User Manager");
        if (!trigger) return false;
        trigger.click();
        window.sessionStorage.setItem(stateKey, "user-manager");
        return true;
      };

      const fillAndSearch = () => {
        const input = findTokenInput();
        if (!input) return false;

        input.focus();
        input.value = targetToken;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

        const searchButton =
          findByText("button, input[type='submit'], input[type='button']", "Search") ||
          findByText("button, input[type='submit'], input[type='button']", "Buscar");

        if (searchButton) {
          searchButton.click();
          window.sessionStorage.setItem(stateKey, "searched");
          return true;
        }

        return false;
      };

      const openFirstUsername = () => {
        const rows = Array.from(document.querySelectorAll("tr"));
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll("td"));
          if (cells.length === 0) continue;

          const usernameCell = cells[0];
          const clickable = usernameCell.querySelector("a, button") || usernameCell;
          const text = normalize(clickable.textContent || "");
          if (!text) continue;

          clickable.scrollIntoView({ block: "center", behavior: "instant" });
          clickable.click();
          window.sessionStorage.setItem(stateKey, "user-opened");
          return true;
        }

        return false;
      };

      const clickOtherActions = () => {
        const button =
          findByText("button, a, [role='button']", "Other Actions") ||
          findByText("button, a, [role='button']", "Other actions");
        if (!button) return false;
        button.scrollIntoView({ block: "center", behavior: "instant" });
        button.click();
        window.sessionStorage.setItem(stateKey, "other-actions-opened");
        return true;
      };

      const clickResetPassword = () => {
        const option = findByText("a, button, [role='menuitem'], [role='option'], li", "Reset password");
        if (!option) return false;
        option.scrollIntoView({ block: "center", behavior: "instant" });
        option.click();
        window.sessionStorage.setItem(stateKey, "reset-password-opened");
        return true;
      };

      if ((currentState === "other-actions-opened" || currentState === "user-opened") && clickResetPassword()) {
        return { ok: true, action: "reset-password-opened" };
      }

      if (currentState === "user-opened" && clickOtherActions()) {
        return { ok: true, action: "opened-other-actions" };
      }

      if (currentState === "searched" && openFirstUsername()) {
        return { ok: true, action: "opened-user" };
      }

      if (currentState === "searched") {
        return { ok: false, action: "waiting-results" };
      }

      if ((currentState === "start" || currentState === "user-manager") && fillAndSearch()) {
        return { ok: true, action: "searched-token" };
      }

      if ((currentState === "start" || currentState === "user-manager") && clickUserManager()) {
        return { ok: true, action: "clicked-user-manager" };
      }

      if (clickResetPassword()) {
        return { ok: true, action: "reset-password-opened" };
      }

      if (clickOtherActions()) {
        return { ok: true, action: "opened-other-actions" };
      }

      return { ok: false, action: "waiting-dom" };
    })();
  `;
}

function attemptMeeAdminAutofill(windowRef, automation) {
  if (!windowRef || windowRef.isDestroyed() || !automation?.value) return;

  const currentUrl = windowRef.webContents.getURL();
  if (!currentUrl || currentUrl.startsWith("about:blank")) return;

  const script = automation.type === "reset-password"
    ? createMeeResetPasswordAutomationScript(automation.value, automation.runId)
    : createMeeUserManagerAutomationScript(automation.value, automation.runId);

  windowRef.webContents
    .executeJavaScript(script)
    .then((result) => {
      if (["no-results", "edit-profile-opened", "reset-password-opened"].includes(result?.action)) {
        stopMeeAdminAutofillLoop();
      }
    })
    .catch(() => {});
}

function stopMeeAdminAutofillLoop() {
  if (meeAdminAutofillInterval) {
    clearInterval(meeAdminAutofillInterval);
    meeAdminAutofillInterval = null;
  }
}

function startMeeAdminAutofillLoop(windowRef, automation) {
  stopMeeAdminAutofillLoop();
  let attempts = 0;

  meeAdminAutofillInterval = setInterval(() => {
    if (!windowRef || windowRef.isDestroyed()) {
      stopMeeAdminAutofillLoop();
      return;
    }

    attempts += 1;
    attemptMeeAdminAutofill(windowRef, automation);

    if (attempts >= 30) {
      stopMeeAdminAutofillLoop();
    }
  }, 1000);
}

async function openMeeUserManagerWindow(email) {
  return openMeeAdminWindow({ type: "user-manager", value: email, runId: Date.now().toString(36) });
}

async function openMeeResetPasswordWindow(token) {
  clipboard.writeText("Macmillaniberia");
  return openMeeAdminWindow({ type: "reset-password", value: token, runId: Date.now().toString(36) });
}

async function openMeeAdminWindow(automation) {
  const desktopEnv = loadDesktopEnv();
  const meeAdminUrl = desktopEnv.MEE_ADMIN_URL || process.env.MEE_ADMIN_URL || DEFAULT_MEE_ADMIN_URL;

  pendingMeeEmail = automation.value;
  pendingMeeAutomation = automation;

  if (meeAdminWindow && !meeAdminWindow.isDestroyed()) {
    meeAdminWindow.focus();
    const currentUrl = meeAdminWindow.webContents.getURL();
    if (!currentUrl || currentUrl.startsWith("about:blank")) {
      await meeAdminWindow.loadURL(meeAdminUrl);
    } else {
      attemptMeeAdminAutofill(meeAdminWindow, pendingMeeAutomation);
      startMeeAdminAutofillLoop(meeAdminWindow, pendingMeeAutomation);
    }
    return;
  }

  meeAdminWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    title: "MEE Admin",
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:mee-admin",
    },
  });

  meeAdminWindow.on("closed", () => {
    stopMeeAdminAutofillLoop();
    meeAdminWindow = null;
    pendingMeeAutomation = null;
  });

  meeAdminWindow.webContents.setWindowOpenHandler(({ url }) => {
    meeAdminWindow.loadURL(url);
    return { action: "deny" };
  });

  const autofill = () => attemptMeeAdminAutofill(meeAdminWindow, pendingMeeAutomation);
  meeAdminWindow.webContents.on("did-finish-load", autofill);
  meeAdminWindow.webContents.on("did-navigate-in-page", autofill);
  meeAdminWindow.webContents.on("did-navigate", autofill);

  await meeAdminWindow.loadURL(meeAdminUrl);
  startMeeAdminAutofillLoop(meeAdminWindow, pendingMeeAutomation);
}

async function openSalesforceWindow() {
  const desktopEnv = loadDesktopEnv();
  const salesforceUrl = desktopEnv.SALESFORCE_URL || process.env.SALESFORCE_URL || DEFAULT_SALESFORCE_URL;

  if (salesforceWindow && !salesforceWindow.isDestroyed()) {
    salesforceWindow.focus();
    if (!salesforceWindow.webContents.getURL() || salesforceWindow.webContents.getURL().startsWith("about:blank")) {
      await salesforceWindow.loadURL(salesforceUrl);
    }
    return;
  }

  salesforceWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    title: "SalesForce",
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:salesforce",
    },
  });

  salesforceWindow.on("closed", () => {
    stopSalesforceSearchLoop();
    salesforceWindow = null;
  });

  salesforceWindow.webContents.setWindowOpenHandler(({ url }) => {
    salesforceWindow.loadURL(url);
    return { action: "deny" };
  });

  await salesforceWindow.loadURL(salesforceUrl);
}

function stopSalesforceSearchLoop() {
  if (salesforceSearchInterval) {
    clearInterval(salesforceSearchInterval);
    salesforceSearchInterval = null;
  }
}

function createSalesforceSearchScript(email) {
  return `
    (async () => {
      const email = ${JSON.stringify(email)};
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const deepQuerySelectorAll = (selector, root = document) => {
        const results = Array.from(root.querySelectorAll(selector));
        const nodes = Array.from(root.querySelectorAll("*"));
        for (const node of nodes) {
          if (node.shadowRoot) {
            results.push(...deepQuerySelectorAll(selector, node.shadowRoot));
          }
        }
        return results;
      };
      const searchButton = deepQuerySelectorAll("button.search-button[aria-label='Buscar'], button[aria-label='Buscar']")
        .filter(visible)
        .find((button) => (button.textContent || "").toLowerCase().includes("buscar"));
      if (searchButton) {
        searchButton.scrollIntoView({ block: "center", inline: "center" });
        searchButton.click();
        await wait(450);
      }
      const selectors = [
        "input[placeholder*='Buscar']",
        "input[aria-label*='Buscar']",
        "input[title*='Buscar']",
        "input[type='search']",
        "input[placeholder*='Search']",
        "input[aria-label*='Search']",
        "input[title*='Search']",
        ".forceSearchInput input",
        ".forceSearchInputDesktop input",
        ".slds-global-header__item_search input",
        "input.searchBox",
        "lightning-input input"
      ];
      const input = selectors
        .flatMap((selector) => deepQuerySelectorAll(selector))
        .filter(visible)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];

      if (!input) return { ok: false, reason: "search-input-not-found" };

      input.scrollIntoView({ block: "center", inline: "center" });
      input.focus();
      input.click();
      await wait(120);
      input.select?.();
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (valueSetter) {
        valueSetter.call(input, email);
      } else {
        input.value = email;
      }
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: email }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(180);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, composed: true }));
      input.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, composed: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, composed: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "NumpadEnter", keyCode: 13, which: 13, bubbles: true, composed: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "NumpadEnter", keyCode: 13, which: 13, bubbles: true, composed: true }));
      await wait(250);
      const searchOption = deepQuerySelectorAll("[role='option'], a, button")
        .filter(visible)
        .find((element) => {
          const text = (element.textContent || "").toLowerCase();
          return text.includes("buscar") && text.includes(email.toLowerCase());
        });
      if (searchOption) {
        searchOption.click();
        return { ok: true, reason: "clicked-search-option" };
      }
      const globalSearchButton = deepQuerySelectorAll("button[type='submit'], button[title*='Buscar'], button[aria-label*='Buscar']")
        .filter(visible)
        .find((button) => {
          const text = (button.textContent || button.getAttribute("title") || button.getAttribute("aria-label") || "").toLowerCase();
          return text.includes("buscar") || text.includes("search");
        });
      if (globalSearchButton && globalSearchButton !== searchButton) {
        globalSearchButton.click();
        return { ok: true, reason: "clicked-search-button" };
      }
      if (document.activeElement === input) {
        const form = input.closest("form");
        if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
      return { ok: true, reason: "searched" };
    })();
  `;
}

async function attemptSalesforceSearch(windowRef, email) {
  if (!windowRef || windowRef.isDestroyed() || !email) return false;
  try {
    const result = await windowRef.webContents.executeJavaScript(createSalesforceSearchScript(email), true);
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

function startSalesforceSearchLoop(windowRef, email) {
  stopSalesforceSearchLoop();
  let attempts = 0;

  salesforceSearchInterval = setInterval(async () => {
    if (!windowRef || windowRef.isDestroyed()) {
      stopSalesforceSearchLoop();
      return;
    }

    attempts += 1;
    const found = await attemptSalesforceSearch(windowRef, email);
    if (found || attempts >= 20) {
      stopSalesforceSearchLoop();
    }
  }, 1200);
}

async function openSalesforceSearchWindow(email) {
  await openSalesforceWindow();
  clipboard.writeText(email);
  startSalesforceSearchLoop(salesforceWindow, email);
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

ipcMain.handle("mee-admin:open-user-manager", async (_event, payload) => {
  const email = payload?.email ? String(payload.email).trim().toLowerCase() : "";
  if (!email) {
    throw new Error("No se ha proporcionado un email valido.");
  }

  await openMeeUserManagerWindow(email);
  return { ok: true };
});

ipcMain.handle("mee-admin:open-reset-password", async (_event, payload) => {
  const token = payload?.token ? String(payload.token).trim() : "";
  if (!token) {
    throw new Error("No se ha proporcionado un token valido.");
  }

  await openMeeResetPasswordWindow(token);
  return { ok: true };
});

ipcMain.handle("salesforce:open", async () => {
  await openSalesforceWindow();
  return { ok: true };
});

ipcMain.handle("salesforce:search-email", async (_event, payload) => {
  const email = payload?.email ? String(payload.email).trim().toLowerCase() : "";
  if (!email) {
    throw new Error("Este ticket no tiene un email disponible para buscar en Salesforce.");
  }

  await openSalesforceSearchWindow(email);
  return { ok: true };
});

ipcMain.handle("mochilas-app:open", async () => {
  const exePath = resolveMochilasDesktopExe();

  if (!exePath || !fs.existsSync(exePath)) {
    throw new Error("No se ha encontrado la app de Consulta de Mochilas en este equipo.");
  }

  const openError = await shell.openPath(exePath);
  if (openError) {
    throw new Error(openError);
  }

  return { ok: true };
});

ipcMain.handle("mochilas-app:open-order", async (_event, payload) => {
  const orderId = payload?.orderId ? String(payload.orderId).trim() : "";
  if (!orderId) {
    throw new Error("Este ticket no tiene numero de pedido.");
  }

  const exePath = resolveMochilasDesktopExe();

  if (!exePath || !fs.existsSync(exePath)) {
    throw new Error("No se ha encontrado la app de Consulta de Mochilas en este equipo.");
  }

  clipboard.writeText(orderId);

  const openError = await shell.openPath(exePath);
  if (openError) {
    throw new Error(openError);
  }

  await focusMochilasAndSearchOrder(orderId);
  return { ok: true };
});

ipcMain.handle("outlook:send-ticket-resolved-email", async (_event, payload) => {
  if (!payload?.ticketNumber || !payload?.title) {
    throw new Error("Faltan datos del ticket para enviar el correo.");
  }

  await sendResolvedTicketEmailWithOutlook(payload);
  return { ok: true };
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    title: "Soporte Macmillan",
    icon: resolveWindowIcon(),
    backgroundColor: "#f7f8fb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(BACKEND_URL);
  const showMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
  };

  mainWindow.once("ready-to-show", showMainWindow);
  showMainWindow();
}

async function bootstrap() {
  try {
    startBackend();
    await waitForServer(BACKEND_URL, START_TIMEOUT_MS);
    await createWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo arrancar la aplicacion.";
    dialog.showErrorBox("Soporte Macmillan", message);
    app.quit();
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});

if (singleInstanceLock) {
  app.whenReady().then(bootstrap);
}
