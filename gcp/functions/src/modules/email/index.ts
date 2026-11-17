// Reminder and notification emails (docs/design/stretch/email.md, docs/contracts/email.md). Off by default (EMAIL_ENABLED).
export { onEmailOutboxCreated, emailUnsubscribeV1, emailWebhookV1, emailOpenV1 } from "./transport/emailFunctions";
export { emailChannel, emailChannelDependencies } from "./transport/emailFunctions";
