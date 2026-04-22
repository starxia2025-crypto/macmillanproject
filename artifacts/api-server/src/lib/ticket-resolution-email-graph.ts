type TicketResolutionEmailInput = {
  recipient: string;
  ticketNumber: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  creatorName: string | null;
  creatorEmail: string | null;
  schoolName: string | null;
  tenantName: string | null;
  resolvedByName: string | null;
  resolvedAt: Date;
};

function buildTicketResolutionEmailText(input: TicketResolutionEmailInput) {
  return [
    `Ticket: ${input.ticketNumber}`,
    `Asunto: ${input.title}`,
    `Estado: ${input.status}`,
    `Prioridad: ${input.priority}`,
    `Colegio: ${input.schoolName || "-"}`,
    `Red educativa: ${input.tenantName || "-"}`,
    `Creador: ${input.creatorName || "-"}`,
    `Email creador: ${input.creatorEmail || "-"}`,
    `Resuelto por: ${input.resolvedByName || "-"}`,
    `Fecha de resolucion: ${input.resolvedAt.toLocaleString("es-ES")}`,
    "",
    "Descripcion:",
    input.description || "-",
  ].join("\n");
}

export async function sendTicketResolvedEmail(input: TicketResolutionEmailInput) {
  const tenantId = process.env["MICROSOFT_TENANT_ID"];
  const clientId = process.env["MICROSOFT_CLIENT_ID"];
  const clientSecret = process.env["MICROSOFT_CLIENT_SECRET"];
  const fromAddress =
    process.env["MICROSOFT_GRAPH_SENDMAIL_FROM"] ||
    process.env["SMTP_FROM"] ||
    process.env["SMTP_USER"];

  if (!tenantId || !clientId || !clientSecret || !fromAddress) {
    console.error("Ticket resolved email Graph skipped: Graph not configured", {
      hasTenantId: Boolean(tenantId),
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret),
      fromAddress,
      recipient: input.recipient,
    });
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
    console.error("Ticket resolved email Graph token failed", {
      tenantId,
      clientId,
      fromAddress,
      recipient: input.recipient,
      status: tokenResponse.status,
      error: tokenData.error,
      errorDescription: tokenData.error_description,
    });
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
        subject: `[Ticket resuelto] ${input.ticketNumber} - ${input.title}`,
        body: {
          contentType: "Text",
          content: buildTicketResolutionEmailText(input),
        },
        toRecipients: [
          {
            emailAddress: {
              address: input.recipient,
            },
          },
        ],
      },
      saveToSentItems: true,
    }),
  });

  if (!mailResponse.ok) {
    const mailError = await mailResponse.text();
    console.error("Ticket resolved email Graph send failed", {
      fromAddress,
      recipient: input.recipient,
      status: mailResponse.status,
      body: mailError,
    });
    throw new Error(`Graph sendMail failed (${mailResponse.status})`);
  }

  console.info("Ticket resolved email sent with Graph", {
    fromAddress,
    recipient: input.recipient,
  });

  return { sent: true as const };
}
