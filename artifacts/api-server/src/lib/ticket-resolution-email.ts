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

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value === "") return fallback;
  return value === "true" || value === "1";
}

export async function sendTicketResolvedEmail(input: TicketResolutionEmailInput) {
  const smtpHost = process.env["SMTP_HOST"];
  const smtpPort = Number(process.env["SMTP_PORT"] || "587");
  const smtpUser = process.env["SMTP_USER"];
  const smtpPass = process.env["SMTP_PASS"];
  const smtpSecure = parseBoolean(process.env["SMTP_SECURE"], smtpPort === 465);
  const fromAddress = process.env["SMTP_FROM"] || smtpUser;

  if (!smtpHost || !fromAddress || Number.isNaN(smtpPort)) {
    console.error("Ticket resolved email skipped: SMTP not configured", {
      hasHost: Boolean(smtpHost),
      smtpPort,
      hasUser: Boolean(smtpUser),
      hasPass: Boolean(smtpPass),
      fromAddress,
    });
    return { sent: false as const, reason: "smtp_not_configured" as const };
  }

  const nodemailerModule = await import("nodemailer");
  const transporter = nodemailerModule.default.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  });

  try {
    await transporter.verify();
  } catch (error) {
    console.error("Ticket resolved email SMTP verify failed", {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      fromAddress,
      recipient: input.recipient,
      error,
    });
    throw error;
  }

  const lines = [
    `Ticket: ${input.ticketNumber}`,
    `Asunto: ${input.title}`,
    `Estado: ${input.status}`,
    `Prioridad: ${input.priority}`,
    `Colegio: ${input.schoolName || "-"}`,
    `Red educativa: ${input.tenantName || "-"}`,
    `Creador: ${input.creatorName || "-"}`,
    `Email creador: ${input.creatorEmail || "-"}`,
    `Resuelto por: ${input.resolvedByName || "-"}`,
    `Fecha de resolución: ${input.resolvedAt.toLocaleString("es-ES")}`,
    "",
    "Descripción:",
    input.description || "-",
  ];

  try {
    const result = await transporter.sendMail({
      from: fromAddress,
      to: input.recipient,
      subject: `[Ticket resuelto] ${input.ticketNumber} - ${input.title}`,
      text: lines.join("\n"),
    });

    console.info("Ticket resolved email sent", {
      recipient: input.recipient,
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
      response: result.response,
    });
  } catch (error) {
    console.error("Ticket resolved email send failed", {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      fromAddress,
      recipient: input.recipient,
      error,
    });
    throw error;
  }

  return { sent: true as const };
}
