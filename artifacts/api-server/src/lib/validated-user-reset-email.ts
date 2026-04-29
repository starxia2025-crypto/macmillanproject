type ValidatedUserResetEmailInput = {
  recipient: string;
  recipientName: string | null;
  resetUrl: string;
  ticketNumber: string;
  requestedByName: string | null;
  supportOperatorName: string | null;
};

function buildValidatedUserResetText(input: ValidatedUserResetEmailInput) {
  return [
    `Hola ${input.recipientName || ""},`.trim(),
    "",
    "Hemos restablecido tu acceso a Macmillan Bridge.",
    "Para definir una nueva contrasena de acceso, utiliza este enlace seguro y temporal:",
    input.resetUrl,
    "",
    "Este enlace caduca en 30 minutos y solo puede utilizarse una vez.",
    "Si no has solicitado esta gestion, contacta con el equipo de soporte.",
    "",
    `Ticket de soporte: ${input.ticketNumber}`,
    `Solicitante: ${input.requestedByName || "-"}`,
    `Gestionado por: ${input.supportOperatorName || "-"}`,
  ].join("\n");
}

function buildValidatedUserResetHtml(input: ValidatedUserResetEmailInput) {
  const greeting = input.recipientName ? `Hola ${input.recipientName},` : "Hola,";
  return `
    <p>${greeting}</p>
    <p>Hemos restablecido tu acceso a <strong>Macmillan Bridge</strong>.</p>
    <p>Para definir una nueva contrasena de acceso, utiliza este enlace seguro y temporal:</p>
    <p><a href="${input.resetUrl}">${input.resetUrl}</a></p>
    <p>Este enlace caduca en 30 minutos y solo puede utilizarse una vez.</p>
    <p>Si no has solicitado esta gestion, contacta con el equipo de soporte.</p>
    <hr />
    <p><strong>Ticket de soporte:</strong> ${input.ticketNumber}</p>
    <p><strong>Solicitante:</strong> ${input.requestedByName || "-"}</p>
    <p><strong>Gestionado por:</strong> ${input.supportOperatorName || "-"}</p>
  `;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value === "") return fallback;
  return value === "true" || value === "1";
}

export async function sendValidatedUserResetEmail(input: ValidatedUserResetEmailInput) {
  const tenantId = process.env["MICROSOFT_TENANT_ID"];
  const clientId = process.env["MICROSOFT_CLIENT_ID"];
  const clientSecret = process.env["MICROSOFT_CLIENT_SECRET"];
  const graphFromAddress =
    process.env["MICROSOFT_GRAPH_SENDMAIL_FROM"] ||
    process.env["SMTP_FROM"] ||
    process.env["SMTP_USER"];

  if (tenantId && clientId && clientSecret && graphFromAddress) {
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

    const mailResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(graphFromAddress)}/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: `[Bridge] Restablecimiento de acceso - ${input.ticketNumber}`,
          body: {
            contentType: "HTML",
            content: buildValidatedUserResetHtml(input),
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
      throw new Error(`Graph sendMail failed (${mailResponse.status})`);
    }

    return { sent: true as const, provider: "graph" as const };
  }

  const smtpHost = process.env["SMTP_HOST"];
  const smtpPort = Number(process.env["SMTP_PORT"] || "587");
  const smtpUser = process.env["SMTP_USER"];
  const smtpPass = process.env["SMTP_PASS"];
  const smtpSecure = parseBoolean(process.env["SMTP_SECURE"], smtpPort === 465);
  const fromAddress = process.env["SMTP_FROM"] || smtpUser;

  if (!smtpHost || !fromAddress || Number.isNaN(smtpPort)) {
    return { sent: false as const, reason: "email_not_configured" as const };
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
    subject: `[Bridge] Restablecimiento de acceso - ${input.ticketNumber}`,
    text: buildValidatedUserResetText(input),
    html: buildValidatedUserResetHtml(input),
  });

  return { sent: true as const, provider: "smtp" as const };
}
