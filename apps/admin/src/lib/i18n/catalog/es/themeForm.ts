// Spanish (neutral Latin American, informal "tú") for the themeForm area. Draft: needs review by a native speaker.

import type { themeForm as source } from "../en/themeForm";

export const themeForm: Record<keyof typeof source, string> = {
  // Pages (new and edit)
  "themeForm.new.title": "Tema nuevo",
  "themeForm.new.subtitle": "Los miembros lo ven en Inicio cuando empieza su primera semana.",
  "themeForm.edit.title": "Editar tema",
  "themeForm.edit.subtitle": "Los cambios aparecen en la app en cuanto los guardas.",
  "themeForm.edit.loading": "Cargando tema",
  "themeForm.edit.noTheme": "No se seleccionó ningún tema. Elige uno de la lista de temas semanales.",
  "themeForm.edit.loadFailed": "No se pudo cargar este tema. Revisa tu conexión e inténtalo de nuevo.",
  "themeForm.edit.backLabel": "Volver a temas semanales",

  // Banners
  "themeForm.fixFields": "Corrige {count, plural, one {# campo} other {# campos}} para continuar.",
  "themeForm.reloadLatest": "Recargar última versión",

  // Theme picker
  "themeForm.theme": "Tema",
  "themeForm.themeHint": "Cada tema es una ilustración diseñada que viene con la app. Elige uno para completar un título, descripción, meta y etiqueta que aún puedes cambiar.",
  "themeForm.whyItsFun": "Por qué es divertido:",
  "themeForm.membersPost": "Los miembros publican: {prompt}",

  // Title, description, tags
  "themeForm.titleLabel": "Título",
  "themeForm.titleHint": "Se muestra en mayúsculas en la tarjeta de Inicio de la app.",
  "themeForm.description": "Descripción",
  "themeForm.tags": "Etiquetas",
  "themeForm.tagsLoading": "Cargando etiquetas…",
  "themeForm.tagsError": "No se pudieron cargar las etiquetas.",
  "themeForm.tagsRetry": "Reintentar",

  // Weeks
  "themeForm.weeks": "Semanas",
  "themeForm.firstWeek": "Primera semana",
  "themeForm.chooseWeek": "Elige una semana",
  "themeForm.optionTaken": "{label} (ocupada: {title})",
  "themeForm.runsUntil": "Dura hasta",
  "themeForm.chooseLastDay": "Elige el último día",
  "themeForm.optionOverlaps": "{label} (se superpone con {title})",
  "themeForm.weeksHintLocked": "El inicio está bloqueado porque ya se unieron personas. Aún puedes cambiar cuándo termina, siempre que no sea en el pasado.",
  "themeForm.weeksHint": "Los temas van del lunes a las 12:00 a. m. al domingo a las 11:59 p. m., {zone}, por una o dos semanas. Las semanas que ya tienen un tema aparecen como ocupadas.",

  // Goal and reward
  "themeForm.goalReward": "Meta y recompensa",
  "themeForm.goal": "Meta",
  "themeForm.unit": "Unidad",
  "themeForm.pointsReward": "Puntos de recompensa",
  "themeForm.pointsHint": "Se suman a los puntos del miembro cuando un organizador aprueba su participación (de 0 a {max}).",
  "themeForm.counts": "{joined} se unieron · {completed} completaron. Estos conteos se actualizan a medida que los miembros participan.",

  // Actions, dialog, toasts
  "themeForm.saving": "Guardando…",
  "themeForm.saveChanges": "Guardar cambios",
  "themeForm.create": "Crear tema",
  "themeForm.cancel": "Cancelar",
  "themeForm.discard.title": "¿Descartar tus cambios?",
  "themeForm.discard.confirm": "Descartar cambios",
  "themeForm.discard.bodyEdit": "Los cambios que hiciste en este tema no se guardarán.",
  "themeForm.discard.bodyNew": "El tema que empezaste no se guardará.",
  "themeForm.toast.saved": "Se guardaron los cambios de “{title}”.",
  "themeForm.toast.created": "Se creó “{title}”.",

  // Errors the form authors
  "themeForm.error.overlap": "Se superpone con otro tema ({window}). Elige una semana sin tema.",
  "themeForm.error.unconfirmedSave": "No pudimos confirmar si se guardaron tus cambios. Recarga la última versión para comprobarlo antes de guardar de nuevo.",
  "themeForm.error.createFailed": "No se pudo crear el tema. Tu borrador se conserva; volver a intentarlo es seguro y no creará un duplicado.",

  // Preview
  "themeForm.preview.aria": "Vista previa",
  "themeForm.preview.label": "Vista previa: el reto de esta semana",
  "themeForm.preview.titleFallback": "Título del tema",
  "themeForm.preview.others": "+ {count} más participando",
  "themeForm.preview.first": "Sé el primero esta semana",
  "themeForm.preview.week": "Semana",
  "themeForm.preview.weekEmpty": "Elige las semanas",
  "themeForm.preview.goal": "Meta",
  "themeForm.preview.reward": "Recompensa",
  "themeForm.preview.notSet": "Sin definir",
};
