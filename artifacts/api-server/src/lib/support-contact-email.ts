type SupportContactEmailInput = {
  recipient: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone?: string | null;
  schoolName?: string | null;
  subject?: string | null;
  message: string;
};

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value === "") return fallback;
  return value === "true" || value === "1";
}

function buildSupportContactEmailText(input: SupportContactEmailInput) {
  return [
    "Nueva solicitud de contacto desde la pantalla de acceso de Bridge.",
    "",
    `Nombre: ${input.requesterName}`,
    `Email: ${input.requesterEmail}`,
    `Telefono: ${input.requesterPhone || "-"}`,
    `Colegio o centro: ${input.schoolName || "-"}`,
    `Asunto: ${input.subject || "-"}`,
    "",
    "Mensaje:",
    input.message,
  ].join("\n");
}

async function sendWithGraph(input: SupportContactEmailInput) {
  const tenantId = process.env["MICROSOFT_TENANT_ID"];
  const clientId = process.env["MICROSOFT_CLIENT_ID"];
  const clientSecret = process.env["MICROSOFT_CLIENT_SECRET"];
  const fromAddress =
    process.env["MICROSOFT_GRAPH_SENDMAIL_FROM"] ||
    process.env["SMTP_FROM"] ||
    process.env["SMTP_USER"];

  if (!tenantId || !clientId || !clientSecret || !fromAddress) {
    return { sent: false as const, reason: "graph_not_configured" as const };
  }

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });

  const tokenData = await tokenResponse.json() as { access_token?: string; error?: string; error_description?: string };
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(`Graph token request failed (${tokenResponse.status})`);
  }

  const mailResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromAddress)}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: `[Bridge soporte] ${input.subject || "Nuevo mensaje desde login"} - ${input.requesterName}`,
        body: {
          contentType: "Text",
          content: buildSupportContactEmailText(input),
        },
        toRecipients: [
          {
            emailAddress: {
              address: input.recipient,
            },
          },
        ],
        replyTo: [
          {
            emailAddress: {
              address: input.requesterEmail,
            },
          },
        ],
      },
      saveToSentItems: true,
    }),
  });

  if (!mailResponse.ok) {
    throw new Error(`Graph sendMail failed (${mailResponse.status})`);
  }

  return { sent: true as const, via: "graph" as const };
}

async function sendWithSmtp(input: SupportContactEmailInput) {
  const smtpHost = process.env["SMTP_HOST"];
  const smtpPort = Number(process.env["SMTP_PORT"] || "587");
  const smtpUser = process.env["SMTP_USER"];
  const smtpPass = process.env["SMTP_PASS"];
  const smtpSecure = parseBoolean(process.env["SMTP_SECURE"], smtpPort === 465);
  const fromAddress = process.env["SMTP_FROM"] || smtpUser;

  if (!smtpHost || !fromAddress || Number.isNaN(smtpPort)) {
    return { sent: false as const, reason: "smtp_not_configured" as const };
  }

  const nodemailerModule = await import("nodemailer");
  const transporter = nodemailerModule.default.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  });

  await transporter.verify();
  await transporter.sendMail({
    from: fromAddress,
    to: input.recipient,
    replyTo: input.requesterEmail,
    subject: `[Bridge soporte] ${input.subject || "Nuevo mensaje desde login"} - ${input.requesterName}`,
    text: buildSupportContactEmailText(input),
  });

  return { sent: true as const, via: "smtp" as const };
}

export async function sendSupportContactEmail(input: SupportContactEmailInput) {
  try {
    const graphResult = await sendWithGraph(input);
    if (graphResult.sent) {
      return graphResult;
    }
  } catch (error) {
    console.error("Support contact email Graph send failed", {
      recipient: input.recipient,
      requesterEmail: input.requesterEmail,
      error,
    });
  }

  const smtpResult = await sendWithSmtp(input);
  if (smtpResult.sent) {
    return smtpResult;
  }

  return { sent: false as const, reason: "mail_not_configured" as const };
}
