// Reminder and notification emails (docs/design/stretch/email.md, docs/contracts/email.md). Off by default (EMAIL_ENABLED).
export { onEmailOutboxCreated, emailUnsubscribeV1, emailWebhookV1, emailOpenV1, emailOutboxReaper } from "./transport/emailFunctions";
export { emailChannel, emailChannelDependencies } from "./transport/emailFunctions";
// For the shared router: `deliverNotification({ ...deps, email: routerEmailChannel(emailChannelDependencies()) }, request)`.
export { routerEmailChannel } from "./application/routerChannel";
