"use client";

import LocaleMenu from "@/components/LocaleMenu";
import TimezoneMenu from "@/components/TimezoneMenu";
import TwoFactorSettings from "@/components/TwoFactorSettings";
import ChangePassword from "@/components/ChangePassword";
import GoogleLinkSettings from "@/components/GoogleLinkSettings";
import DeleteAccount from "@/components/DeleteAccount";
import MentorShareSettings from "@/components/MentorShareSettings";
import { useI18n } from "@/lib/i18n/provider";

export default function GeneralSettingsPage() {
  const { t } = useI18n();

  return (
    <div className="px-6 py-5 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">{t("nav.general")}</h1>
        <p className="text-sm text-muted">{t("settings.subtitle")}</p>
      </div>

      <div className="card p-5 mb-5 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium text-sm">{t("settings.language")}</h3>
          <p className="text-xs text-faint mt-0.5">{t("settings.languageHint")}</p>
        </div>
        <LocaleMenu />
      </div>

      <div className="card p-5 mb-5 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium text-sm">{t("settings.timezone")}</h3>
          <p className="text-xs text-faint mt-0.5">{t("settings.timezoneHint")}</p>
        </div>
        <TimezoneMenu />
      </div>

      <MentorShareSettings />

      <ChangePassword />
      <GoogleLinkSettings />
      <TwoFactorSettings />
      <DeleteAccount />
    </div>
  );
}
