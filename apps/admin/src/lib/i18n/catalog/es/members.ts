// Spanish (neutral Latin American, informal "tú") for the members area. Draft: needs review by a native speaker.

import type { members as source } from "../en/members";

export const members: Record<keyof typeof source, string> = {
  "members.title": "Miembros",
  "members.subtitle": "Todas las personas de tu empresa. Los administradores pueden abrir un perfil para editar sus datos.",
  "members.loading": "Cargando miembros",
  "members.filterByStatus": "Filtrar por estado",

  "members.status.all": "Todos",
  "members.status.active": "Activos",
  "members.status.invited": "Invitados",
  "members.status.deactivated": "Desactivados",

  "members.chip.active": "Activo",
  "members.chip.invited": "Invitado",
  "members.chip.deactivated": "Desactivado",

  "members.search.label": "Buscar por nombre, correo o cargo",
  "members.search.placeholder": "Buscar por nombre, correo o cargo",
  "members.filter.role": "Rol",
  "members.filter.allRoles": "Todos los roles",
  "members.filter.team": "Equipo",
  "members.filter.allTeams": "Todos los equipos",
  "members.filter.location": "Lugar de trabajo",
  "members.filter.allLocations": "Todos los lugares",
  "members.filter.clear": "Borrar filtros",

  "members.empty.title": "Nadie coincide",
  "members.empty.body": "Borra un filtro o busca otro nombre.",
  "members.table.label": "Miembros de la empresa",
  "members.table.name": "Nombre",
  "members.table.role": "Rol",
  "members.table.teams": "Equipos",
  "members.table.location": "Lugar de trabajo",
  "members.table.status": "Estado",
  "members.table.points": "Puntos",

  "members.count.showingOf": "Mostrando {shown} de {total, plural, one {# persona} other {# personas}}",
  "members.count.matchesSoFar": "{shown} coincidencias hasta ahora",
  "members.count.matches": "{shown, plural, one {# persona coincide} other {# personas coinciden}}",
  "members.count.withTotal": "{matches} (de {total})",

  "members.export.done": "Se exportaron {count, plural, one {# persona} other {# personas}} a members.csv.",
  "members.sub.points": "{count, plural, one {# punto} other {# puntos}}",
};
