// Spanish (neutral Latin American, informal "tú") for the bugs area. Draft: needs review by a native speaker.

import type { bugs as source } from "../en/bugs";

export const bugs: Record<keyof typeof source, string> = {
  // Page
  "bugs.title": "Reportes de errores",
  "bugs.subtitle": "Lo que las personas envían al sacudir el teléfono o desde Perfil. Solo los administradores pueden verlos, incluido quién los envió.",
  "bugs.loading": "Cargando reportes de errores",
  "bugs.list.label": "Reportes",

  // Status and category labels
  "bugs.status.all": "Todos",
  "bugs.status.new": "Nuevo",
  "bugs.status.triaged": "Clasificado",
  "bugs.status.resolved": "Resuelto",
  "bugs.category.bug": "Error",
  "bugs.category.confusing": "Confuso",
  "bugs.category.looksWrong": "Se ve mal",
  "bugs.category.idea": "Idea",
  "bugs.category.unspecified": "Sin categoría",

  // Screens the report came from
  "bugs.screen.home": "Inicio",
  "bugs.screen.rewards": "Recompensas",
  "bugs.screen.myEvents": "Mis eventos",
  "bugs.screen.profile": "Perfil",
  "bugs.screen.event": "Evento",
  "bugs.screen.participants": "Participantes",
  "bugs.screen.album": "Álbum",
  "bugs.screen.challenge": "Reto",
  "bugs.screen.other": "Otra",

  // Diagnostics labels
  "bugs.diag.appVersion": "Versión de la app",
  "bugs.diag.os": "Sistema",
  "bugs.diag.device": "Dispositivo",
  "bugs.diag.language": "Idioma",
  "bugs.diag.screen": "Pantalla",
  "bugs.diag.install": "Instalación",

  // Filters
  "bugs.filterByStatus": "Filtrar por estado",
  "bugs.search.label": "Buscar reportes",
  "bugs.search.placeholder": "Texto, persona o pantalla",
  "bugs.filters.show": "Filtros",
  "bugs.filters.hide": "Ocultar filtros",
  "bugs.filters.active": "{count} activos",
  "bugs.filters.category": "Categoría",
  "bugs.filters.allCategories": "Todas las categorías",
  "bugs.filters.from": "Desde",
  "bugs.filters.to": "Hasta",
  "bugs.filters.clear": "Borrar filtros",
  "bugs.filters.rangeBad": "La fecha final es anterior a la fecha inicial.",
  "bugs.counts.capped": "Los conteos incluyen los 1,000 reportes más recientes. Los más antiguos se siguen mostrando al cargar más.",

  // Empty states
  "bugs.empty.noMatches.title": "Sin coincidencias",
  "bugs.empty.noMatches.body": "Prueba con otra búsqueda, categoría o rango de fechas.",
  "bugs.empty.all.title": "Aún no hay reportes",
  "bugs.empty.all.body": "Cuando alguien sacuda su teléfono y envíe comentarios, aparecerán aquí.",
  "bugs.empty.new.title": "Bandeja vacía",
  "bugs.empty.new.body": "No hay nada nuevo que revisar. Los reportes que necesitan clasificación aparecen aquí.",
  "bugs.empty.triaged.title": "Nada clasificado",
  "bugs.empty.triaged.body": "Los reportes que ya revisaste pero no cerraste esperan aquí.",
  "bugs.empty.resolved.title": "Nada resuelto todavía",
  "bugs.empty.resolved.body": "Los reportes cerrados se guardan aquí como referencia.",
  "bugs.empty.pick.title": "Elige un reporte",
  "bugs.empty.pick.body": "Selecciona uno de la lista para leerlo y clasificarlo.",

  // Result count
  "bugs.count.showingOf": "Mostrando {shown} de {total, plural, one {# reporte} other {# reportes}}",
  "bugs.count.soFar": "{shown} reportes hasta ahora",
  "bugs.count.matches": "{shown, plural, one {# reporte coincide} other {# reportes coinciden}}",

  // List items
  "bugs.item.noDescription": "Sin descripción",
  "bugs.item.screenshot": "Captura",
  "bugs.item.note": "Nota",
  "bugs.item.tryAgain": "Reintentar",

  // Detail
  "bugs.detail.label": "Reporte de error de {name}",
  "bugs.detail.allReports": "Todos los reportes",
  "bugs.detail.loading": "Cargando reporte",
  "bugs.detail.sentShake": "Enviado {when} desde {screen} al sacudir el teléfono.",
  "bugs.detail.sentProfile": "Enviado {when} desde {screen} en Perfil.",
  "bugs.detail.loadFailed": "No se pudo cargar este reporte. Revisa tu conexión e inténtalo de nuevo.",
  "bugs.detail.wrote": "Lo que escribió",
  "bugs.detail.noDescription": "Sin descripción.",
  "bugs.detail.screenshot": "Captura de pantalla",
  "bugs.detail.shotGone": "La captura de pantalla ya no está disponible.",
  "bugs.detail.shotNone": "No se adjuntó ninguna captura de pantalla.",
  "bugs.detail.diagnostics": "Diagnósticos",
  "bugs.detail.noDiagnostics": "La app no incluyó diagnósticos.",

  // Screenshot viewer
  "bugs.shot.expired": "El enlace de la captura venció o no se pudo cargar.",
  "bugs.shot.reload": "Recargar reporte",
  "bugs.shot.viewLabel": "Ver en tamaño completo: captura de pantalla de {who}",
  "bugs.shot.alt": "Captura de pantalla de {who}",
  "bugs.shot.viewFull": "Ver en tamaño completo",
  "bugs.shot.dialog": "Captura de pantalla de {who}",
  "bugs.shot.close": "Cerrar",

  // Triage form
  "bugs.triage.title": "Clasificación",
  "bugs.triage.status": "Estado",
  "bugs.triage.assignee": "Asignado a",
  "bugs.triage.unassigned": "Sin asignar",
  "bugs.triage.formerAdmin": "Antiguo administrador",
  "bugs.triage.note": "Nota interna",
  "bugs.triage.notePlaceholder": "Pasos para reproducir, enlace al ticket, decisión",
  "bugs.triage.hint": "Solo los administradores ven esto. {length}/{max}",
  "bugs.triage.hintSaved": "Solo los administradores ven esto. {length}/{max} · Último guardado {when}",
  "bugs.triage.hintSavedBy": "Solo los administradores ven esto. {length}/{max} · Último guardado {when} por {name}",
  "bugs.triage.conflict": "Otra persona actualizó este reporte. Recárgalo para ver sus cambios y vuelve a guardar.",
  "bugs.triage.reload": "Recargar reporte",
  "bugs.triage.saving": "Guardando…",
  "bugs.triage.save": "Guardar cambios",
  "bugs.triage.copied": "Copiado",
  "bugs.triage.copy": "Copiar como texto del problema",
  "bugs.triage.copiedStatus": "Texto del problema copiado al portapapeles",
  "bugs.triage.copyFailed": "No se pudo copiar. Selecciona el texto y cópialo tú.",
  "bugs.triage.noChanges": "No hay cambios que guardar",
  "bugs.triage.saved": "Guardado.",
  "bugs.triage.nothingToChange": "No hay nada que cambiar.",
  "bugs.item.assignedTo": "Asignado a {name}",
};
