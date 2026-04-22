import { pool } from "@workspace/db";

export type MochilaRow = {
  schoolName: string | null;
  studentName: string | null;
  studentSurname: string | null;
  studentEmail: string | null;
  type: string | null;
  studentUser: string | null;
  studentPassword: string | null;
  token: string | null;
  description: string | null;
  ean: string | null;
  idOrder: string | null;
  idConsignaOrder: number;
  esGoogle: boolean | null;
};

export type MochilaLookupResult = {
  studentEmail: string;
  studentName: string | null;
  studentSurname: string | null;
  studentUser: string | null;
  studentPassword: string | null;
  token: string | null;
  schools: string[];
  records: MochilaRow[];
};

type MochilaQueryRow = {
  school_name: string | null;
  student_name: string | null;
  student_surname: string | null;
  student_email: string | null;
  type: string | null;
  student_user: string | null;
  student_password: string | null;
  token: string | null;
  description: string | null;
  ean: string | null;
  id_order: string | null;
  id_consigna_order: number;
  esGoogle: number | boolean | null;
};

function mapMochilaRow(row: MochilaQueryRow): MochilaRow {
  return {
    schoolName: row.school_name,
    studentName: row.student_name,
    studentSurname: row.student_surname,
    studentEmail: row.student_email,
    type: row.type,
    studentUser: row.student_user,
    studentPassword: row.student_password,
    token: row.token,
    description: row.description,
    ean: row.ean,
    idOrder: row.id_order,
    idConsignaOrder: row.id_consigna_order,
    esGoogle: row.esGoogle === null ? null : Boolean(row.esGoogle),
  };
}

export async function findMochilasStudentByEmail(email: string): Promise<MochilaLookupResult | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const [rows] = await pool.execute(
    `
      SELECT
        school_name,
        student_name,
        student_surname,
        student_email,
        type,
        student_user,
        student_password,
        token,
        description,
        ean,
        id_order,
        id_consigna_order,
        esGoogle
      FROM MOC_Mochilas
      WHERE LOWER(TRIM(student_email)) = ?
      ORDER BY school_name, id_consigna_order
    `,
    [normalizedEmail],
  );

  const matchedRows = rows as MochilaQueryRow[];
  if (!matchedRows.length) {
    return null;
  }

  const records = matchedRows.map((row: MochilaQueryRow) => mapMochilaRow(row));

  const first = records[0];
  return {
    studentEmail: normalizedEmail,
    studentName: first?.studentName ?? null,
    studentSurname: first?.studentSurname ?? null,
    studentUser: first?.studentUser ?? null,
    studentPassword: first?.studentPassword ?? null,
    token: first?.token ?? null,
    schools: [...new Set(records.map((record) => record.schoolName).filter(Boolean) as string[])],
    records,
  };
}

export async function findMochilasStudentByOrderId(orderId: string): Promise<MochilaLookupResult | null> {
  const normalizedOrderId = orderId.trim();
  const [rows] = await pool.execute(
    `
      SELECT
        school_name,
        student_name,
        student_surname,
        student_email,
        type,
        student_user,
        student_password,
        token,
        description,
        ean,
        id_order,
        id_consigna_order,
        esGoogle
      FROM MOC_Mochilas
      WHERE COALESCE(TRIM(id_order), '') = ?
        AND LOWER(TRIM(type)) IN ('mochila', 'mochila_blink')
      ORDER BY school_name, id_order, id_consigna_order
    `,
    [normalizedOrderId],
  );

  const matchedRows = rows as MochilaQueryRow[];
  if (!matchedRows.length) {
    return null;
  }

  const records = matchedRows.map((row: MochilaQueryRow) => mapMochilaRow(row));

  const first = records[0];
  return {
    studentEmail: first?.studentEmail?.trim().toLowerCase() || "",
    studentName: first?.studentName ?? null,
    studentSurname: first?.studentSurname ?? null,
    studentUser: first?.studentUser ?? null,
    studentPassword: first?.studentPassword ?? null,
    token: first?.token ?? null,
    schools: [...new Set(records.map((record) => record.schoolName).filter(Boolean) as string[])],
    records,
  };
}
