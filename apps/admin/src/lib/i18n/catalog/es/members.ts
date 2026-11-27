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
  "members.status.revoked": "Revocados",
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
  "members.filter.clearSearch": "Borrar búsqueda",
  "members.filter.clear": "Borrar filtros",

  "members.empty.title": "Nadie coincide",
  "members.empty.groupBody": "No hay nadie en este grupo por ahora.",
  "members.empty.searchBody": "Prueba con otro nombre o correo, o borra la búsqueda.",
  "members.empty.onlyInvited": "Nadie que se haya unido coincide. Abajo están las personas invitadas que coinciden.",
  "members.empty.body": "Borra un filtro o busca otro nombre.",
  "members.table.label": "Miembros de la empresa",
  "members.table.name": "Nombre",
  "members.table.role": "Rol",
  "members.table.teams": "Equipos",
  "members.table.location": "Lugar de trabajo",
  "members.table.status": "Estado",
  "members.table.points": "Puntos",

  "members.count.showingOf": "Mostrando {shown} de {total, plural, one {# persona} other {# personas}}",
  "members.count.matchesSoFar": "Mostrando los primeros {shown}",
  "members.count.matches": "{shown, plural, one {# persona coincide} other {# personas coinciden}}",

  "members.export.done": "Se exportaron {count, plural, one {# persona} other {# personas}} a members.csv.",
  "members.sub.points": "{count, plural, one {# punto} other {# puntos}}",

  "members.subtitle.invites": "Todas las personas de tu empresa: quienes se unieron y quienes invitaste. Abre a una persona para ver sus datos.",
  "members.invited.section": "{count, plural, one {# persona invitada aún no se une} other {# personas invitadas aún no se unen}}",
  "members.invited.sectionNote": "Reciben el rol y los equipos definidos aquí cuando inician sesión con su correo de trabajo.",
  "members.invited.tableLabel": "Personas invitadas",
  "members.revoked.tableLabel": "Invitaciones revocadas",
  "members.invited.empty.title": "No hay invitaciones pendientes",
  "members.invited.empty.body": "Agrega a una persona o importa una hoja de cálculo para invitar a personas antes de que inicien sesión. Reciben su rol y sus equipos al unirse.",
  "members.revoked.empty.title": "No hay invitaciones revocadas",
  "members.revoked.empty.body": "Las invitaciones que revoques aparecen aquí, para que puedas invitar a alguien de nuevo.",
};
