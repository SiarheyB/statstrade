"use client";

import { Share2 } from "lucide-react";

import MentorShareSettings from "@/components/MentorShareSettings";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Режим ментора — отдельным разделом настроек.
 *
 * Раньше блок жил на общей странице настроек между языком и сменой пароля, но
 * это не «настройка» в один переключатель: там список ссылок, выбор счёта,
 * период и срок жизни. Своя страница даёт ему место и адрес, на который можно
 * сослаться.
 */
export default function MentorSettingsPage() {
  const { t } = useI18n();

  return (
    <div className="px-6 py-5 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Share2 size={18} className="text-accent" /> {t("mentor.title")}
        </h1>
        <p className="text-sm text-muted">{t("mentor.hint")}</p>
      </div>

      <MentorShareSettings />
    </div>
  );
}
