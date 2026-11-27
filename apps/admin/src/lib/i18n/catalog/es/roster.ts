// Spanish (neutral Latin American, informal "tú") for the roster area. Draft: needs review by a native speaker.

import type { roster as source } from "../en/roster";

export const roster: Record<keyof typeof source, string> = {
  "roster.title": "Lista de personal",
  "roster.subtitle": "Todas las personas de tu empresa. Las personas invitadas se agregaron con anticipación y reciben su rol y sus equipos al iniciar sesión; cualquier persona con un correo de la empresa puede unirse.",
  "roster.import": "Importar personas",
  "roster.loading": "Cargando la lista de personal",
  "roster.tableLabel": "Lista de personal",
  "roster.filterLabel": "Filtrar la lista de personal",

  // Filter tabs and state chips
  "roster.filter.all": "Todos",
  "roster.state.invited": "Invitado",
  "roster.state.active": "Activo",
  "roster.state.deactivated": "Desactivado",
  "roster.state.revoked": "Revocado",

  // Search
  "roster.search.label": "Buscar por nombre o correo",
  "roster.search.placeholder": "Buscar por nombre o correo",

  // Unlisted members banner
  "roster.unlisted.headline": "{count, plural, one {# persona inició sesión pero no está en la lista de personal.} other {# personas iniciaron sesión pero no están en la lista de personal.}}",
  "roster.unlisted.detail": "Se unieron antes de que la lista incluyera a todos. Al agregarlas, siguen activas con el mismo rol y los mismos equipos.",
  "roster.unlisted.add": "Agregar miembros existentes",
  "roster.unlisted.checking": "Revisando {count}…",

  // Empty states
  "roster.empty.rosterEmpty": "La lista de personal está vacía",
  "roster.empty.noMatches": "Sin coincidencias",
  "roster.empty.noInvites": "No hay invitaciones pendientes",
  "roster.empty.noPeople": "No hay personas",
  "roster.empty.noActive": "No hay personas activas",
  "roster.empty.noDeactivated": "No hay personas desactivadas",
  "roster.empty.noRevoked": "No hay personas revocadas",
  "roster.empty.importBody": "Importa una hoja de cálculo para agregar personas antes de que inicien sesión.",
  "roster.empty.invitedBody": "Las personas que importes y que aún no hayan iniciado sesión aparecerán aquí como invitadas.",
  "roster.empty.searchBody": "Prueba con otro nombre o correo, o borra la búsqueda.",
  "roster.empty.groupBody": "Por ahora no hay nadie en este grupo.",

  // Result count
  "roster.count.showingOf": "Mostrando {shown} de {total, plural, one {# persona} other {# personas}}",
  "roster.count.matchesSoFar": "{count} coincidencias hasta ahora",
  "roster.count.matches": "{count, plural, one {# persona coincide} other {# personas coinciden}}",

  // Table
  "roster.table.name": "Nombre",
  "roster.table.role": "Rol",
  "roster.table.teams": "Equipos",
  "roster.table.status": "Estado",
  "roster.table.added": "Agregado",
  "roster.table.actions": "Acciones",
  "roster.table.noTeams": "Ninguno",
  "roster.table.resent": "Mensaje compartido {count}×",
  "roster.table.resentLast": "Mensaje compartido {count}×, último {date}",
  "roster.table.emailed": "Correo enviado {count}×",
  "roster.table.emailedLast": "Correo enviado {count}×, último {date}",

  // Row actions
  "roster.action.resend": "Obtener mensaje de invitación",
  "roster.action.resending": "Abriendo…",
  "roster.action.resendAria": "Obtener el mensaje de invitación para {name}",
  "roster.action.revoke": "Revocar",
  "roster.action.revokeAria": "Revocar la invitación de {name}",
  "roster.action.inviteAgain": "Invitar de nuevo",
  "roster.action.inviteAgainAria": "Invitar de nuevo: {name}",
  "roster.action.email": "Enviar invitación por correo",
  "roster.action.emailAria": "Enviar una invitación por correo a {name}",

  // Toasts
  "roster.toast.reinvited": "{name} fue invitado de nuevo. Recibirá el rol y los equipos definidos aquí cuando se registre.",
  "roster.toast.nothingToAdd": "Todas las personas que han iniciado sesión ya están en la lista de personal. No hay nada que agregar.",
  "roster.toast.revoked": "Se revocó la invitación de {email}. No recibirá el rol ni los equipos definidos aquí cuando se registre.",
  "roster.toast.added": "{count, plural, one {Se agregó # persona a la lista de personal.} other {Se agregaron # personas a la lista de personal.}}",
  "roster.toast.copied": "Mensaje de invitación copiado. Envíaselo a {name} por tu cuenta.",
  "roster.toast.addedPerson": "Se agregó a {name} a la lista de personal como invitado. Usa Obtener mensaje de invitación en su fila para enviarle la invitación.",
  "roster.toast.addedPersonEmail": "Se agregó a {name} a la lista de personal como invitado. Usa Enviar invitación por correo en su fila cuando quieras.",
  "roster.toast.addedEmailed": "Se agregó a {name} y se le envió una invitación por correo.",
  "roster.toast.emailed": "Se envió la invitación a {email}. Llegará en unos minutos.",

  // Add one person
  "roster.add": "Agregar persona",
  "roster.add.title": "Agregar una persona",
  "roster.add.intro": "Se agrega como invitada y recibe este rol al iniciar sesión con este correo. DIP no le envía correos; tú le mandas el mensaje de invitación.",
  "roster.add.introEmail": "Se agrega como invitada y recibe este rol al iniciar sesión con este correo.",
  "roster.add.sendEmail": "Enviarle una invitación por correo ahora",
  "roster.add.name": "Nombre",
  "roster.add.email": "Correo de trabajo",
  "roster.add.emailHint": "Debe terminar en @{domain}.",
  "roster.add.role": "Rol",
  "roster.add.confirm": "Agregar persona",
  "roster.add.confirmEmail": "Agregar y enviar invitación",
  "roster.add.busy": "Agregando…",
  "roster.add.nameRequired": "Agrega su nombre.",
  "roster.add.checkDetails": "Revisa los datos de arriba.",
  "roster.add.exists": "Ese correo ya está en la lista de personal. Búscalo para ver o cambiar su entrada.",

  // Revoke dialog
  "roster.revoke.title": "¿Revocar la invitación de {name}?",
  "roster.revoke.confirm": "Revocar invitación",
  "roster.revoke.busy": "Revocando…",
  "roster.revoke.body": "{email} podrá seguir iniciando sesión con una cuenta de trabajo, pero no recibirá el rol, los equipos ni la ubicación definidos aquí. Puedes importarla de nuevo más tarde.",

  // Backfill dialog
  "roster.backfill.title": "¿Agregar miembros existentes a la lista de personal?",
  "roster.backfill.confirm": "{count, plural, one {Agregar # persona} other {Agregar # personas}}",
  "roster.backfill.busy": "Agregando personas…",
  "roster.backfill.signedIn": "{count, plural, one {# persona inició sesión pero no está en la lista de personal.} other {# personas iniciaron sesión pero no están en la lista de personal.}} Se agregan como activas con su rol y equipos actuales.",
  "roster.backfill.existing": "{count} ya incluidas se quedan como están. No se envía ningún correo y es seguro volver a ejecutarlo.",
  "roster.backfill.existingSkipped": "{count} ya incluidas se quedan como están y {skipped} sin correo se omiten. No se envía ningún correo y es seguro volver a ejecutarlo.",

  // Invite message dialog
  "roster.message.title": "Mensaje de invitación para {name}",
  "roster.message.copy": "Copiar mensaje",
  "roster.message.copying": "Copiando…",
  "roster.message.intro": "DIP no envía correos, así que comparte este mensaje con {email} por tu cuenta.",
  "roster.message.introSelf": "Comparte este mensaje con {email} por tu cuenta.",
  "roster.message.recorded": "Mensaje compartido {count}× hasta ahora.",
  "roster.message.label": "Mensaje",
  "roster.message.link": "Enlace: {url}",
  "roster.message.copyFailed": "No se pudo copiar automáticamente. El mensaje está seleccionado: cópialo con Ctrl+C o Cmd+C.",
  "roster.email.title": "¿Enviar una invitación por correo a {name}?",
  "roster.email.confirm": "Enviar correo",
  "roster.email.busy": "Enviando…",
  "roster.email.body": "DIP le envía a {email} un correo con tu invitación y un enlace para iniciar sesión con esa dirección.",
  "roster.email.sentBefore": "Ya se envió {count}×. Última vez: {date}",
  "roster.email.copyInstead": "¿Prefieres enviarla tú?",
  "roster.sub.added": "Agregado el {date}",
};
