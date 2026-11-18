// dipApiV1: one warm dispatcher for the admin portal's light commands (docs/design/functions-dispatcher.md).
// The standalone callables stay exported; this module only adds a second transport to the same handlers.
export { dipApiV1 } from "./transport/dipApiV1";
