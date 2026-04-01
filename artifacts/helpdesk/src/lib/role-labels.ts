export const roleLabels: Record<string, string> = {
  superadmin: "Equipo Macmillan",
  admin_cliente: "Coordinacion",
  manager: "Jefatura de estudio",
  tecnico: "Soporte tecnico",
  usuario_cliente: "Profesorado",
  visor_cliente: "Consulta",
};

export function getRoleLabel(role: string) {
  return roleLabels[role] || role;
}
