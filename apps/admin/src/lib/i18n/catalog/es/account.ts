// Spanish (neutral Latin American, informal "tú") for Your settings. Draft: needs review by a native speaker.

import type { account as source } from "../en/account";

export const account: Record<keyof typeof source, string> = {
  "account.title": "Tus ajustes",
  "account.subtitle": "Tus preferencias de idioma y de correo.",
  "account.empty.title": "Nada que configurar todavía",
  "account.empty.body": "Los ajustes de tu cuenta aparecerán aquí.",
  "account.email.title": "Correo semanal de ideas",
  "account.email.description": "Un correo breve con ideas de eventos para tu empresa, cada semana.",
  "account.language.title": "Idioma",
  "account.language.description": "El idioma de DIP Admin en este navegador. Los títulos de eventos y otros textos que escriben las personas se muestran tal como se escribieron.",
  "account.language.label": "Idioma",
  "account.language.auto": "Igual que este navegador ({language})",
  "account.language.saved": "Idioma guardado.",
  "account.language.note": "El español es una traducción preliminar y puede cambiar.",
  "account.otherEmails.title": "Otros correos de DIP",
  "account.otherEmails.description": "Activa los correos opcionales y mira dónde cambiar los demás.",
  "account.otherEmails.weeklyThemes.label": "Correo del tema semanal",
  "account.otherEmails.weeklyThemes.hint": "Un correo cuando empieza un nuevo tema semanal. Desactivado hasta que lo actives.",
  "account.otherEmails.digest.label": "Resumen diario de la lista de personal",
  "account.otherEmails.digest.hint": "Un correo por la mañana cuando se unieron personas invitadas o terminó una importación el día anterior. Los días sin novedades no se envía nada.",
  "account.otherEmails.loading": "Cargando tus ajustes de correo.",
  "account.otherEmails.loadFailed": "No se pudieron cargar tus ajustes de correo.",
  "account.otherEmails.savedOn": "Correo activado.",
  "account.otherEmails.savedOff": "Correo desactivado.",
  "account.otherEmails.saveFailed": "No se guardó tu ajuste de correo. Inténtalo de nuevo.",
  "account.otherEmails.app": "Invitaciones a eventos, cambios en eventos, recordatorios e invitaciones de calendario: elige cuáles recibes en la app DIP, en Perfil > Notificaciones.",
  "account.otherEmails.account": "Correos de tu cuenta: una bienvenida cuando te unes y un aviso cuando se resuelve un problema que reportaste. Si cancelas la suscripción a todos los correos de DIP, también dejas de recibir estos.",
};
