// Spanish (neutral Latin American, informal "tú") for shared copy. Draft: needs review by a native speaker.

import type { common as source } from "../en/common";

export const common: Record<keyof typeof source, string> = {
  "common.tryAgain": "Intentar de nuevo",
  "common.goBack": "Volver",
  "common.cancel": "Cancelar",
  "common.saving": "Guardando…",
  "common.loadMore": "Cargar más",
  "common.loadingMore": "Cargando más…",
  "common.showingOf": "Mostrando {shown} de {total}",
  "common.showing": "Mostrando {shown}",
  "common.exportCsv": "Exportar CSV",
  "common.exporting": "Exportando…",
  "common.exportFailed": "La exportación no terminó. Inténtalo de nuevo.",
  "common.none": "Ninguno",
  "common.notSet": "Sin definir",
  "common.empty": "Vacío",
  "common.details": "Detalles",
  "common.hideDetails": "Ocultar detalles",
  "common.loadFailed": "No se pudo cargar. Revisa tu conexión e inténtalo de nuevo.",
  "common.actionFailed": "No se pudo completar. Inténtalo de nuevo.",
  "common.genericError": "Algo salió mal. Revisa tu conexión e inténtalo de nuevo.",
  "common.dismissNotification": "Cerrar notificación",
  "common.tabCount": "{label} ({count})",

  "common.listLoading": "La lista todavía se está cargando. Inténtalo de nuevo en un momento.",
  "common.filtersChanged": "Los filtros cambiaron durante la exportación. Inténtalo de nuevo.",

  "common.error.title": "Algo salió mal",
  "common.error.body": "No se pudo mostrar esta página. Inténtalo de nuevo o vuelve al Resumen.",
  "common.error.globalBody": "DIP Admin no se pudo cargar. Inténtalo de nuevo o recarga la página.",
  "common.error.toOverview": "Ir al Resumen",
  "common.notFound.title": "Página no encontrada",
  "common.notFound.body": "Esa página no existe o se movió.",

  "common.role.member": "Miembro",
  "common.role.organizer": "Organizador",
  "common.role.admin": "Administrador",

  "common.dialog.reasonRequired": "{label} (obligatorio)",
  "common.dialog.reasonNeeded": "Agrega un motivo para continuar. ",
  "common.dialog.reasonHint": "Se guarda en el registro de auditoría.",
  "common.dialog.reasonCount": "{count}/{max}",

  "common.boot.loading": "Cargando DIP Admin",
  "common.boot.failedTitle": "No se puede cargar DIP Admin",
  "common.boot.failedBody": "Algo salió mal al iniciar tu sesión. Revisa tu conexión e inténtalo de nuevo.",
  "common.boot.reload": "Recargar",
};
