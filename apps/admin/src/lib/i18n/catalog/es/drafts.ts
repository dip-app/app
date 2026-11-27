// Spanish (neutral Latin American, informal "tú") for autosaved form drafts. Draft: needs review by a native speaker.

import type { drafts as source } from "../en/drafts";

export const drafts: Record<keyof typeof source, string> = {
  "drafts.offer.event": "Tienes un borrador de evento sin terminar, guardado {ago}.",
  "drafts.offer.theme": "Tienes un borrador de reto sin terminar, guardado {ago}.",
  "drafts.offer.replaces": "También tienes un borrador anterior, guardado {ago}. Al restaurarlo se reemplaza lo que hay en esta página.",
  "drafts.agoNow": "hace un momento",
  "drafts.restore": "Restaurar borrador",
  "drafts.startFresh": "Empezar de cero",
  "drafts.restored": "Borrador restaurado. Revisa todo antes de continuar.",
  "drafts.restored.datesReset": "Borrador restaurado. Su fecha ya pasó, así que pusimos la próxima hora libre. Revisa la fecha y la hora.",
  "drafts.restored.weeksReset": "Borrador restaurado. Sus semanas ya no estaban libres, así que elegimos las siguientes libres. Revísalas.",
  "drafts.status.saved": "Borrador guardado en este dispositivo",
  "drafts.status.unavailable": "Borrador sin guardar. Tu navegador bloquea el almacenamiento, así que deja esta página abierta hasta terminar.",
  "drafts.status.tooLarge": "Borrador sin guardar. Es demasiado largo para conservarlo.",
  "drafts.status.otherTab": "Editado en otra pestaña. Tu próximo cambio reemplaza ese borrador.",
  "drafts.deleteOld": "Eliminar borrador anterior",
  "drafts.decline.title": "¿Descartar el borrador guardado?",
  "drafts.decline.body": "El borrador guardado {ago} se eliminará. No se puede deshacer.",
  "drafts.replace.title": "¿Reemplazar lo que hay en esta página?",
  "drafts.replace.body": "Al restaurar el borrador guardado {ago} se reemplaza lo que has escrito aquí.",
  "drafts.discard.title": "¿Descartar este borrador?",
  "drafts.discard.event": "El evento que empezaste y su borrador guardado se eliminarán.",
  "drafts.discard.theme": "El reto que empezaste y su borrador guardado se eliminarán.",
  "drafts.discard.confirm": "Descartar borrador",
};
