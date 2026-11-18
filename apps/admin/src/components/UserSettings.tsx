"use client";
// @i18n-migrated

import type { ComponentType } from "react";
import { type Capability, can } from "@/lib/adminTypes";
import { useApp } from "./AppProvider";
import { type MessageKey, t } from "@/lib/i18n";
import { LanguageSettings } from "./LanguageSettings";
import { SuggestionsEmail } from "./SuggestionsEmail";

interface SettingsSection {
  id: string;
  title: MessageKey;
  description: MessageKey;
  /** Hidden for roles without this capability (the backend still decides). */
  requires?: Capability;
  Body: ComponentType;
}

/** Per-user settings, in page order (title and description are catalog keys). Add a section here to extend the page; company-wide settings do not belong in this list. */
export const USER_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "email", title: "account.email.title", description: "account.email.description", requires: "ai.generate", Body: SuggestionsEmail },
  { id: "language", title: "account.language.title", description: "account.language.description", Body: LanguageSettings },
];

export function UserSettings() {
  const { session } = useApp();
  const sections = USER_SETTINGS_SECTIONS.filter((section) => !section.requires || can(session?.role, section.requires));
  if (sections.length === 0) {
    return <div className="empty"><h2>{t("account.empty.title")}</h2><p>{t("account.empty.body")}</p></div>;
  }
  return (
    <div className="user-settings">
      {sections.map(({ id, title, description, Body }) => (
        <section key={id} className="settings-section" aria-labelledby={`settings-${id}`}>
          <header className="settings-section-head">
            <h2 id={`settings-${id}`}>{t(title)}</h2>
            <p className="muted">{t(description)}</p>
          </header>
          <Body />
        </section>
      ))}
    </div>
  );
}
