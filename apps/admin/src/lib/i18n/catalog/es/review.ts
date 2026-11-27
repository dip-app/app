// Spanish (neutral Latin American, informal "tú") for the review area. Draft: needs review by a native speaker.

import type { review as source } from "../en/review";

export const review: Record<keyof typeof source, string> = {
  "review.title": "Revisar participaciones",
  "review.subtitle": "Aprueba para otorgar los puntos o solicita cambios con una nota. Usa J y K para moverte entre participaciones, o desactiva los atajos.",
  "review.loading": "Cargando participaciones",
  "review.loadingMore": "Cargando más participaciones",
  "review.filterLabel": "Filtrar participaciones",
  "review.queueLabel": "Participaciones",

  "review.status.submitted": "Pendiente",
  "review.status.rejected": "Cambios solicitados",
  "review.status.approved": "Aprobada",

  "review.empty.submitted.title": "Nada pendiente de revisión",
  "review.empty.submitted.body": "Las nuevas participaciones aparecen aquí cuando las envían.",
  "review.empty.rejected.title": "Sin cambios solicitados",
  "review.empty.rejected.body": "Las participaciones con cambios solicitados esperan aquí hasta que el miembro las reenvíe.",
  "review.empty.approved.title": "Aún no hay nada aprobado",
  "review.empty.approved.body": "Aquí se listan las participaciones aprobadas, con los puntos que ganaron.",

  "review.error.noTheme": "No se seleccionó ningún tema semanal. Elige uno de la lista de retos.",
  "review.error.themeMissing": "Ese tema semanal no existe.",
  "review.error.loadFailed": "No se pudieron cargar las participaciones. Revisa tu conexión e inténtalo de nuevo.",
  "review.backToChallenges": "Volver a retos",

  "review.themeMeta": "{window} · {goal}",

  "review.banner.dismiss": "Descartar",
  "review.banner.changed": "{who} cambió esta participación mientras la revisabas. Se volvió a cargar abajo: revisa la actualización y vuelve a revisar.",
  "review.banner.alreadyReviewed": "La participación de {who} ya se había revisado, así que no cambió nada. La lista está al día.",
  "review.banner.alreadyApproved": "La participación de {who} ya estaba aprobada, así que no se otorgaron puntos de nuevo.",
  "review.banner.alreadyRejected": "Ya solicitaste cambios a {who}.",

  "review.toast.approved": "Aprobaste a {who}. Se otorgaron {points} puntos.",
  "review.toast.rejected": "Solicitaste cambios a {who}. Puede reenviar mientras la semana siga abierta.",
  "review.nowShowing": "Ahora ves la participación de {who}.",

  "review.queue.progress": "{progress} de {goal} {unit} · {when}",
  "review.attempt": "Intento {n}",
  "review.noPhotoChip": "Sin foto",

  "review.detail.label": "Participación de {who}",
  "review.detail.submitted": "Enviada {created}",
  "review.detail.submittedUpdated": "Enviada {created}, actualizada {updated}",
  "review.action.approve": "Aprobar · {points} puntos",
  "review.action.requestChanges": "Solicitar cambios",
  "review.nav.previous": "Anterior",
  "review.nav.next": "Siguiente",
  "review.nav.backToList": "Volver a la lista",
  "review.nav.position": "{current} de {total}{more}",

  "review.keys.label": "Atajos de teclado",
  "review.keys.hint": "Atajos de una sola tecla para esta página. Desactívalos si te estorban.",
  "review.keys.next": "Siguiente",
  "review.keys.previous": "Anterior",
  "review.keys.approve": "Aprobar",
  "review.keys.requestChanges": "Solicitar cambios",
  "review.keys.press": "Presiona {key} para {action}",
  "review.keys.pressNext": "ir a la siguiente",
  "review.keys.pressPrevious": "ir a la anterior",
  "review.keys.pressApprove": "aprobar",
  "review.keys.pressRequestChanges": "solicitar cambios",

  "review.facts.progress": "Progreso",
  "review.facts.progressValue": "{progress} de {goal}",
  "review.facts.reward": "Recompensa",
  "review.facts.rewardValue": "{points} puntos",
  "review.note.heading": "Nota del miembro",
  "review.note.none": "Sin nota.",
  "review.evidence.heading": "Evidencia",

  "review.result.approved": "Aprobada. Se otorgaron {points} puntos. Las aprobaciones son definitivas.",
  "review.result.approvedOn": "Aprobada el {when}. Se otorgaron {points} puntos. Las aprobaciones son definitivas.",
  "review.result.rejected": "Cambios solicitados. Se queda aquí hasta que el miembro la reenvíe.",
  "review.result.rejectedOn": "Cambios solicitados el {when}. Se queda aquí hasta que el miembro la reenvíe.",

  "review.photo.none": "Sin foto. Es una participación solo con nota.",
  "review.photo.failed": "No se pudo cargar la foto.",
  "review.photo.loading": "Cargando foto",
  "review.photo.viewAria": "Ver en tamaño completo: foto de {who}",
  "review.photo.alt": "Evidencia de {who}",
  "review.photo.viewFull": "Ver en tamaño completo",
  "review.photo.dialogLabel": "Foto de {who}",
  "review.photo.close": "Cerrar",

  "review.approve.title": "¿Aprobar a {who}?",
  "review.approve.confirm": "Aprobar y otorgar {points} puntos",
  "review.approve.busy": "Aprobando…",
  "review.approve.summaryPhoto": "{progress} de {goal}, con foto.",
  "review.approve.summaryNoPhoto": "{progress} de {goal}, sin foto.",
  "review.approve.pointsBold": "{points} puntos",
  "review.approve.addedNow": "se agregan ahora al saldo de {who}. Las aprobaciones son definitivas y no se pueden deshacer.",

  "review.reject.title": "¿Solicitar cambios a {who}?",
  "review.reject.confirm": "Solicitar cambios",
  "review.reject.busy": "Solicitando cambios…",
  "review.reject.reasonLabel": "¿Qué debería cambiar?",
  "review.reject.reasonHint": "El miembro verá esta nota.",
  "review.reject.body": "{who} recibe tu nota y la participación vuelve a su bandeja. Puede editarla y reenviarla mientras la semana siga abierta.",
};
