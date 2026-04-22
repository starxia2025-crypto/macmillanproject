import ExcelJS from "exceljs";
import sql from "mssql";

const config = {
  server: process.env.SQLSERVER_HOST ?? "SWINMAALPRD0008",
  port: Number(process.env.SQLSERVER_PORT ?? "1433"),
  database: process.env.SQLSERVER_DATABASE ?? "PRETECNICOSBD",
  user: process.env.SQLSERVER_USER ?? "tecnicos",
  password: process.env.SQLSERVER_PASSWORD ?? "",
  options: {
    encrypt: String(process.env.SQLSERVER_ENCRYPT ?? "true").toLowerCase() === "true",
    trustServerCertificate: String(process.env.SQLSERVER_TRUST_CERT ?? "true").toLowerCase() === "true",
  },
};

const workbookPath = "C:/Helpdesk-Saas/migracion_edelvives_importacion.xlsx";

function normalizeCell(value) {
  if (value == null) return "";
  if (typeof value === "object" && value && "text" in value) {
    return String(value.text ?? "").trim();
  }
  return String(value).trim();
}

function getOriginalId(observations) {
  const match = observations.match(/ID original:\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const worksheet = workbook.getWorksheet("Consultas") ?? workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("No se encontro la hoja Consultas en el archivo de migracion.");
  }

  const headerMap = new Map();
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const key = normalizeCell(cell.value).toLowerCase();
    if (key) headerMap.set(key, colNumber);
  });

  const rowsByOriginalId = new Map();
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const observations = normalizeCell(row.getCell(headerMap.get("observaciones")).value);
    if (!observations) continue;

    const originalId = getOriginalId(observations);
    if (!originalId) continue;

    rowsByOriginalId.set(originalId, {
      colegio: normalizeCell(row.getCell(headerMap.get("colegio")).value),
      emailInformador: normalizeCell(row.getCell(headerMap.get("email_informador")).value),
      tipoSujeto: normalizeCell(row.getCell(headerMap.get("tipo_sujeto")).value),
      emailAfectado: normalizeCell(row.getCell(headerMap.get("email_afectado")).value),
      prioridad: normalizeCell(row.getCell(headerMap.get("prioridad")).value),
      estado: normalizeCell(row.getCell(headerMap.get("estado")).value),
      tipoConsulta: normalizeCell(row.getCell(headerMap.get("tipo_consulta")).value),
      descripcion: normalizeCell(row.getCell(headerMap.get("descripcion")).value),
      pedido: normalizeCell(row.getCell(headerMap.get("pedido")).value),
      matricula: normalizeCell(row.getCell(headerMap.get("matricula")).value),
      etapa: normalizeCell(row.getCell(headerMap.get("etapa")).value),
      curso: normalizeCell(row.getCell(headerMap.get("curso")).value),
      asignatura: normalizeCell(row.getCell(headerMap.get("asignatura")).value),
      observaciones,
    });
  }

  const pool = await sql.connect(config);
  const existing = await pool.request().query(`
    SELECT id, title, description, status, custom_fields
    FROM dbo.SOP_tickets
    WHERE created_by_id = 14
      AND tenant_id = 3
      AND JSON_VALUE(custom_fields, '$.importedFromBulk') = 'true'
  `);

  let updated = 0;

  for (const ticket of existing.recordset) {
    const customFields = ticket.custom_fields ? JSON.parse(ticket.custom_fields) : {};
    const originalId = getOriginalId(String(customFields.observations ?? ""));
    if (!originalId) continue;

    const source = rowsByOriginalId.get(originalId);
    if (!source) continue;

    const nextCustomFields = {
      ...customFields,
      importedSchool: source.colegio,
      studentEmail: source.emailAfectado || null,
      subjectType: source.tipoSujeto,
      inquiryType: source.tipoConsulta,
      orderId: source.pedido || null,
      studentEnrollment: source.matricula || null,
      stage: source.etapa || null,
      course: source.curso || null,
      subject: source.asignatura || null,
      observations: source.observaciones || null,
      importReporterEmail: source.emailInformador,
    };

    await pool
      .request()
      .input("id", sql.Int, ticket.id)
      .input("title", sql.NVarChar(500), `${source.colegio} - ${source.tipoConsulta}`)
      .input("description", sql.NVarChar(sql.MAX), source.descripcion)
      .input("status", sql.NVarChar(50), source.estado)
      .input("priority", sql.NVarChar(20), source.prioridad)
      .input("customFields", sql.NVarChar(sql.MAX), JSON.stringify(nextCustomFields))
      .query(`
        UPDATE dbo.SOP_tickets
        SET
          title = @title,
          description = @description,
          status = @status,
          priority = @priority,
          custom_fields = @customFields,
          updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    updated += 1;
  }

  await pool.close();
  console.log(`Tickets reparados: ${updated}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
