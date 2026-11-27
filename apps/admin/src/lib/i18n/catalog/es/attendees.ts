// Spanish copy for the attendees and album pages. Neutral Latin American Spanish, informal "tú". Needs native review.
import type { attendees as source } from "../en/attendees";

export const attendees: Record<keyof typeof source, string> = {
  // Attendees page: shell and loading
  "attendees.title": "Asistentes",
  "attendees.subtitle": "Quién va y quién asistió. Los cambios se registran en el registro de auditoría.",
  "attendees.loading": "Cargando asistentes",
  "attendees.backToEvents": "Volver a eventos",

  // Toolbar
  "attendees.going": "{count} de {capacity} asistirán",
  "attendees.checkedInCount": "{count} con llegada registrada",
  "attendees.exportCsv": "Exportar CSV",
  "attendees.addAttendee": "Agregar asistente",

  // Add panel
  "attendees.add.panel": "Agregar asistente",
  "attendees.add.heading": "Agregar a un miembro como asistente",
  "attendees.add.searchLabel": "Buscar miembros por nombre o correo",
  "attendees.add.button": "Agregar",
  "attendees.add.noMatch": "Ningún miembro activo coincide.",
  "attendees.add.loadingMembers": "Cargando miembros…",

  // Search and results
  "attendees.search.label": "Buscar asistentes",
  "attendees.search.placeholder": "Buscar asistentes",
  "attendees.empty.title": "Aún no va nadie",
  "attendees.empty.body": "Agrega miembros tú mismo, o pueden unirse desde la app.",
  "attendees.noMatches.title": "Sin coincidencias",
  "attendees.noMatches.body": "Prueba con otro nombre, correo o departamento.",
  "attendees.count.matches": "{shown} de {total} asistentes coinciden",
  "attendees.count.total": "{count, plural, one {# asistente} other {# asistentes}}",

  // Table
  "attendees.table.label": "Asistentes de {title}",
  "attendees.table.name": "Nombre",
  "attendees.table.department": "Departamento",
  "attendees.table.rsvp": "Confirmación",
  "attendees.table.attendance": "Asistencia",
  "attendees.table.actions": "Acciones",
  "attendees.table.addedByStaff": "Agregado por el personal",
  "attendees.status.checkedIn": "Llegó",
  "attendees.status.noShow": "No asistió",
  "attendees.status.notCheckedIn": "Sin registrar",
  "attendees.action.undo": "Deshacer",
  "attendees.action.checkIn": "Registrar",
  "attendees.action.undoCheckInFor": "Deshacer registro de llegada de {name}",
  "attendees.action.checkInFor": "Registrar llegada de {name}",
  "attendees.action.opensAtStart": "La asistencia se abre cuando empieza el evento",
  "attendees.action.remove": "Quitar",
  "attendees.action.removeNamed": "Quitar a {name}",

  // Toasts
  "attendees.toast.checkedIn": "{name}: llegada registrada.",
  "attendees.toast.notCheckedIn": "{name}: marcado como sin llegada registrada.",
  "attendees.toast.pointsAwarded": "Se otorgaron {count} puntos.",
  "attendees.toast.undone": "Se deshizo el registro de llegada de {name}.",
  "attendees.toast.exported": "{count, plural, one {Se exportó # asistente.} other {Se exportaron # asistentes.}}",
  "attendees.toast.exportFailed": "No se pudo terminar la exportación. Inténtalo de nuevo.",
  "attendees.toast.nowGoing": "{name} ahora va al evento.",
  "attendees.toast.removed": "{name} se quitó del evento.",

  // Add dialog
  "attendees.addDialog.title": "¿Agregar a {name}?",
  "attendees.addDialog.confirm": "Agregar como asistente",
  "attendees.addDialog.busy": "Agregando…",
  "attendees.addDialog.reason": "¿Por qué el evento supera su cupo?",
  "attendees.addDialog.body": "Se marca como asistente y recibe las notificaciones predeterminadas del evento.",
  "attendees.addDialog.full": "El evento está lleno ({capacity} lugares). Al agregarlo, el cupo aumenta en uno y se necesita un motivo.",
  "attendees.notify.label": "Notificar",
  "attendees.notify.addedHint": "Envía una notificación de que se agregó a la persona.",
  "attendees.notify.removedHint": "Envía una notificación de que se quitó a la persona.",

  // Remove dialog
  "attendees.removeDialog.title": "¿Quitar a {name}?",
  "attendees.removeDialog.confirm": "Quitar del evento",
  "attendees.removeDialog.busy": "Quitando…",
  "attendees.removeDialog.reason": "¿Por qué se quita a esta persona?",
  "attendees.removeDialog.body": "Su confirmación se cancela y el total de asistentes baja en uno. La asistencia ya registrada se conserva.",

  // Album page: shell and loading
  "album.title": "Álbum del evento",
  "album.subtitle": "Fotos que los miembros compartieron después del evento. Quita lo que no corresponda.",
  "album.loading": "Cargando álbum",
  "album.loadingComments": "Cargando comentarios",

  // Photos
  "album.photoUnavailable": "Foto no disponible",
  "album.photoBy": "Foto de {name}",
  "album.count.photos": "{count, plural, one {# foto} other {# fotos}}",
  "album.count.comments": "{count, plural, one {# comentario} other {# comentarios}}",
  "album.empty.title": "Aún no hay fotos",
  "album.empty.body": "Los miembros que asistieron pueden agregar fotos cuando termine el evento. Aparecerán aquí.",
  "album.grid.label": "Fotos del álbum",
  "album.tile.label": "{name}, {date}, {count, plural, one {# comentario} other {# comentarios}}: abrir foto",

  // Viewer
  "album.viewer.close": "Cerrar",
  "album.viewer.comments": "Comentarios ({count})",
  "album.viewer.noComments": "No hay comentarios en esta foto.",
  "album.viewer.removeCommentBy": "Quitar comentario de {name}",
  "album.viewer.remove": "Quitar",
  "album.viewer.removePhoto": "Quitar foto",

  // Remove dialog
  "album.remove.photoTitle": "¿Quitar esta foto?",
  "album.remove.commentTitle": "¿Quitar este comentario?",
  "album.remove.photoConfirm": "Quitar foto",
  "album.remove.commentConfirm": "Quitar comentario",
  "album.remove.reason": "¿Por qué se quita?",
  "album.remove.photoBody": "La foto, su archivo y sus {count} comentarios se eliminan para todos. No se puede deshacer. La eliminación queda en el registro de auditoría.",
  "album.remove.commentBody": "El comentario de {name} se elimina para todos. No se puede deshacer. La eliminación queda en el registro de auditoría.",
  "album.remove.photoDone": "Foto quitada. Sus comentarios se fueron con ella y el cupo de subida del miembro vuelve a estar libre.",
  "album.remove.commentDone": "Comentario quitado.",
  "attendees.full": "Cupo lleno",
  "attendees.sub.rsvp": "Confirmó el {date}",
};
