"use client";

import { Redirect, rosterToMembers } from "@/components/Redirect";

/** Moved: the Roster is part of Members now (Invited and Revoked views). */
export default function RosterRedirect() {
  return <Redirect to={rosterToMembers} />;
}
