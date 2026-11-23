import type { EmailChannelPort } from "../../notifications/application/router";
import { NOTIFICATION_KINDS } from "../../notifications/domain/categories";
import { isTemplateId, templateCategory, type TemplateVariables } from "../domain/templates/types";
import { emailChannel, type ChannelDeps } from "./enqueueEmail";

/**
 * Adapter that plugs the email channel into the shared `deliverNotification` router (EML-8). The router passes its
 * opaque `request.email` payload; anything that is not a known template of the same category as the notification kind
 * is skipped, and the variables are validated against the template allow-list before anything is stored.
 */
export function routerEmailChannel(deps: ChannelDeps): EmailChannelPort {
  return {
    async deliver(request, recipient, pushWillDeliver) {
      const payload = request.email;
      if (!payload || !isTemplateId(payload.template)) return false;
      // The email's switch must be the notification's own, except the 24 h reminder email, whose email-only switch
      // (`day_before_reminders`) belongs to the shared `reminder` notification.
      const category = templateCategory(payload.template, payload.variables);
      const reminderTwin = request.kind === "reminder" && category === NOTIFICATION_KINDS.reminder_day_before.category;
      if (category !== NOTIFICATION_KINDS[request.kind].category && !reminderTwin) return false;
      const result = await emailChannel(deps, {
        template: payload.template,
        variables: payload.variables as TemplateVariables[typeof payload.template],
        uid: recipient.uid,
        companyId: request.companyId,
        objectId: payload.objectId,
        revisionOrWindow: payload.revisionOrWindow,
        notAfter: payload.notAfter ?? null,
        eventLevel: recipient.eventLevel ?? null,
        pushWillDeliver,
      });
      return result.enqueue?.enqueued === true;
    },
  };
}
