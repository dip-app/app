// Spanish (neutral Latin American, informal "tú") for the sign-in page. Draft: needs review by a native speaker.

import type { login as source } from "../en/login";

export const login: Record<keyof typeof source, string> = {
  "login.title": "Organiza las actividades de tu equipo",
  "login.lead": "El portal de organizadores de DIP. Planea eventos, mantén los álbumes en orden y cuida de tu gente, todo en un solo lugar.",
  "login.google": "Iniciar sesión con Google",
  "login.mockAdmin": "Iniciar sesión como administrador",
  "login.mockOrganizer": "Ver como organizador",
  "login.failed": "El inicio de sesión no terminó. Inténtalo de nuevo.",
  "login.value.events.title": "Eventos",
  "login.value.events.text": "Crea, edita y cancela",
  "login.value.albums.title": "Álbumes y moderación",
  "login.value.albums.text": "Mantén las fotos acordes a tu marca",
  "login.value.attendees.title": "Asistentes",
  "login.value.attendees.text": "Mira quién va",
  "login.value.roster.title": "Miembros y personal",
  "login.value.roster.text": "Invita y gestiona personas",
  "login.value.import.title": "Importación masiva",
  "login.value.import.text": "Agrega un equipo completo de una vez",
  "login.value.challenges.title": "Revisión de retos",
  "login.value.challenges.text": "Aprueba participaciones",
};
