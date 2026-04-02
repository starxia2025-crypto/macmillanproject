export const roleLabels: Record<string, string> = {
  superadmin: "Todos los permisos",
  admin_cliente: "Coordinacion",
  manager: "Jefatura de estudio",
  tecnico: "Soporte tecnico",
  usuario_cliente: "Profesorado",
  visor_cliente: "Comerciales",
};

export function getRoleLabel(role: string) {
  return roleLabels[role] || role;
}
