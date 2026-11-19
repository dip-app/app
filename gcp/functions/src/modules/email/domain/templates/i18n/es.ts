import type { en } from "./en";

/**
 * Spanish email copy: neutral Latin American Spanish with informal "tú", the glossary of the iOS app and the admin
 * portal (evento, actividad, reto, participación, Perfil > Notificaciones). The lead starts a new sentence after the
 * greeting ("¡Hola, Sam! Te agregaron..."), so Spanish leads are capitalized. Typed against the English keys, so tsc
 * fails on a missing key.
 */
export const es: Readonly<Record<keyof typeof en, string>> = {
  "email.lead.named": "¡Hola, {name}! {lead}",
  "email.lead.anonymous": "¡Hola! {lead}",
  "email.preheader.onDay": "{sentence} ({day}).",

  "email.card.when": "Cuándo",
  "email.card.where": "Dónde",
  "email.card.was": "antes: ",
  "email.text.was": "(antes: {value})",
  "email.time.range": "{start} a {end}",
  "email.cta.open": "Abrir en DIP",
  "email.badge.updated": "Actualizado",
  "email.badge.canceled": "Cancelado",

  "email.footer.reason": "Recibes este correo porque tienes activados los correos de {reason}.",
  "email.footer.unsubscribe": "Cancelar suscripción",
  "email.footer.manage": "Administrar en DIP: {path}",
  "email.footer.profile": "Perfil",
  "email.footer.notifications": "Notificaciones",
  "email.footer.sentBy": "Enviado por DIP",
  "email.footer.questions": "¿Preguntas?",

  "email.reason.invites": "invitaciones",
  "email.reason.event_updates": "cambios en eventos",
  "email.reason.reminders": "recordatorios",
  "email.reason.challenges": "retos",
  "email.reason.discovery": "sugerencias de eventos",
  "email.reason.calendar_invites": "invitaciones de calendario",
  "email.reason.admin_suggestions": "ideas semanales de eventos",

  "email.inviteReceived.heading": "Nueva invitación",
  "email.inviteReceived.subject": "{who} te invitó a {title}",
  "email.inviteReceived.preheader": "{who} te invitó a {title}.",
  "email.inviteReceived.lead": "{who} te invitó a un evento en DIP.",
  "email.inviteReceived.note": "Mira quién va y responde.",

  "email.inviteAnswered.heading": "{answer, select, accepted {Invitación aceptada} other {Invitación rechazada}}",
  "email.inviteAnswered.subject": "{who} {answer, select, accepted {aceptó} other {rechazó}} tu invitación a {title}",
  "email.inviteAnswered.preheader": "{who} {answer, select, accepted {aceptó} other {rechazó}} tu invitación a {title}.",
  "email.inviteAnswered.lead": "{who} {answer, select, accepted {aceptó} other {rechazó}} tu invitación a este evento.",

  "email.eventChanged.heading": "Evento actualizado",
  "email.eventChanged.subject": "Actualizado: {title} (cambios en {what})",
  "email.eventChanged.preheader": "Hay cambios en {what} de {title}.",
  "email.eventChanged.lead": "Hay cambios en {what} de este evento.",
  "email.change.date": "la fecha",
  "email.change.dateAndTime": "la fecha y la hora",
  "email.change.time": "la hora",
  "email.change.location": "el lugar",
  "email.change.title": "el título",
  "email.change.details": "los detalles",
  "email.note.calendar": "Para agregarlo a tu calendario, abre el evento en DIP.",

  "email.eventCanceled.heading": "Evento cancelado",
  "email.eventCanceled.subject": "Cancelado: {title}",
  "email.eventCanceled.preheader": "Se canceló {title}.",
  "email.eventCanceled.lead": "Se canceló este evento.",
  "email.eventCanceled.note": "Explora otros eventos.",

  "email.attendeeAdded.heading": "Te agregaron",
  "email.attendeeAdded.subject": "Te agregaron a {title}",
  "email.attendeeAdded.preheader": "Estás en la lista de invitados de {title}.",
  "email.attendeeAdded.lead": "Te agregaron a este evento.",

  "email.reminder.heading": "{window, select, day {Empieza mañana} other {Empieza en aproximadamente una hora}}",
  "email.reminder.subject": "{window, select, day {Mañana: {title}} other {Empieza en aproximadamente una hora: {title}}}",
  "email.reminder.preheader": "{window, select, day {{title} es mañana.} other {{title} empieza en aproximadamente una hora.}}",
  "email.reminder.lead": "{window, select, day {{title} empieza mañana.} other {{title} empieza en aproximadamente una hora.}}",

  "email.calendarInvite.heading": "{reason, select, updated {Calendario actualizado} other {Agrégalo a tu calendario}}",
  "email.calendarInvite.subject": "{reason, select, updated {Invitación actualizada: {title}} other {Invitación de calendario: {title}}}",
  "email.calendarInvite.preheader": "{reason, select, updated {Cambiaron los detalles de {title}.} other {Agrega {title} a tu calendario.}}",
  "email.calendarInvite.lead": "{reason, select, updated {Cambió la hora o el lugar de este evento.} other {Te uniste a este evento.}}",
  "email.calendarInvite.note": "{reason, select, updated {Abre la invitación de calendario adjunta para actualizar tu calendario.} other {Abre la invitación adjunta (invite.ics) y elige Agregar al calendario. Si cambia la hora o el lugar, te enviaremos una invitación actualizada.}}",

  "email.calendarCancel.heading": "{reason, select, left {Se quitó de tu calendario} other {Evento cancelado}}",
  "email.calendarCancel.subject": "{reason, select, left {Se quitó de tu calendario: {title}} other {Cancelado: {title}}}",
  "email.calendarCancel.preheader": "{reason, select, left {{title} se quitó de tu calendario.} other {Se canceló {title}.}}",
  "email.calendarCancel.lead": "{reason, select, left {Ya no vas a este evento.} other {Se canceló este evento.}}",
  "email.calendarCancel.note": "El mensaje de calendario adjunto lo quita de tu calendario.",

  "email.challenge.heading": "{outcome, select, approved {Participación aprobada} other {Se pidieron cambios}}",
  "email.challenge.subject": "{outcome, select, approved {Aprobada: {title}} other {Se pidieron cambios: {title}}}",
  "email.challenge.preheader": "{outcome, select, approved {Se aprobó tu participación en {title}.} other {Un revisor pidió cambios en {title}.}}",
  "email.challenge.lead": "{outcome, select, approved {Se aprobó tu participación en “{title}”.} other {Un revisor pidió cambios en tu participación en “{title}”.}}",
  "email.challenge.points": "{points, plural, one {+{points} punto} other {+{points} puntos}}",
  "email.challenge.note": "Revisa los comentarios y vuelve a enviarla.",

  "email.ics.description": "Abrir en DIP: {url}",
  "email.ics.alarm": "{title} empieza pronto",

  "email.ideas.heading": "Tus ideas semanales de eventos",
  "email.ideas.subject": "Tus ideas de eventos para la {week}",
  "email.ideas.hi.named": "¡Hola, {name}!",
  "email.ideas.hi.anonymous": "¡Hola!",
  "email.ideas.lead.withHistory": "{hi} {count, plural, one {Aquí tienes {count} idea} other {Aquí tienes {count} ideas}} para las próximas semanas, elegidas según lo que le gusta a tu equipo y cómo salieron los eventos anteriores.",
  "email.ideas.lead.short": "{hi} {count, plural, one {Aquí tienes {count} idea} other {Aquí tienes {count} ideas}} para las próximas semanas.",
  "email.ideas.topPick": "La mejor opción: {title}",
  "email.ideas.fit.perfect": "Ajuste perfecto",
  "email.ideas.fit.great": "Gran elección",
  "email.ideas.fit.good": "Buena opción",
  "email.ideas.why": "Por qué esta idea",
  "email.ideas.start": "Crear este evento",
  "email.ideas.startLabel": "Crear este evento: {title}",
  "email.ideas.open": "Abrir ideas de eventos",
  "email.ideas.footer.reason": "Recibes este correo porque activaste las ideas semanales de eventos para administradores.",
  "email.ideas.footer.manage": "Administrar en el portal de administración",
  "email.ideas.text.when": "Cuándo: {hint}",
};

/** Spanish for server-written sentences that reach the ideas email as stored text (matched exactly, else shown as is). */
export const ES_STORED_TEXT: Readonly<Record<string, string>> = {
  "We don't have much activity from your team yet, so these come from our catalog of crowd favorites.":
    "Todavía no hay mucha actividad de tu equipo, así que estas ideas vienen de nuestro catálogo de favoritas.",
};
