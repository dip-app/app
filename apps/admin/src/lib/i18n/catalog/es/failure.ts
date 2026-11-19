// Spanish (neutral Latin American, informal "tú") for plain-language error copy. See ../en/failure.ts.

import type { failure as source } from "../en/failure";

export const failure: Record<keyof typeof source, string> = {
  "failure.network": "No se puede conectar con DIP. Revisa tu conexión e inténtalo de nuevo.",
  "failure.busy": "DIP está ocupado en este momento. Inténtalo de nuevo en un momento.",
  "failure.busyDipbot": "Dipbot está ocupado en este momento. Inténtalo de nuevo en un momento.",
  "failure.signedOut": "Tu sesión terminó. Inicia sesión de nuevo para continuar.",
  "failure.permission": "No tienes acceso para hacer esto. Pídeselo a un administrador de la empresa si lo necesitas.",
  "failure.rateLimit": "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
  "failure.validation": "Algunos datos necesitan corrección. Revísalos e inténtalo de nuevo.",
  "failure.rejected": "DIP no pudo aceptar estos cambios. Revísalos e inténtalo de nuevo; si sigue pasando, contacta a soporte.",
  "failure.rejectedAction": "DIP no pudo hacer esto. Inténtalo de nuevo; si sigue pasando, contacta a soporte.",
  "failure.notFound": "Esto ya no existe. Es posible que se haya eliminado.",
  "failure.conflict": "Alguien más cambió esto desde que lo abriste. Carga la versión más reciente (se perderán tus cambios aquí).",
  "failure.reloadLoses": "Al cargar la versión más reciente se pierden tus cambios aquí.",
  "failure.unavailable": "No se puede hacer esto ahora. Vuelve a cargar la página e inténtalo de nuevo.",
  "failure.unknown": "Algo salió mal. Inténtalo de nuevo.",
  "failure.field": "Revisa este campo.",
  "failure.venuesOff": "Las sugerencias de lugares están desactivadas para tu empresa.",

  "failure.title.load": "No se pudo cargar",
  "failure.title.save": "No se pudo guardar",

  "failure.signIn": "Iniciar sesión",
};
