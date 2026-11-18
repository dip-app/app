import type { ReactNode } from "react";

/**
 * "Nothing here yet": a dashed box with a title, one sentence and at most one action. Use it for an empty list, an
 * unavailable page or a missing item; use InlineNotice for a message inside content that is still there.
 */
export function EmptyState({ title, body, action, art, role }: { title: string; body: ReactNode; action?: ReactNode; /** Optional decorative illustration URL. */ art?: string; role?: "alert" | "status" }) {
  return (
    <div className="empty" role={role}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, unoptimized images */}
      {art && <img className="empty-art" src={art} alt="" width={120} height={90} draggable={false} />}
      <h2>{title}</h2>
      <p>{body}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
