"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Check, HardDrive } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

type Status = { configured: boolean; connected: boolean; email: string | null };

// Настройки интеграции с Google Drive — используется для загрузки
// скриншотов сделок (см. колонка «Изображение» в разделе «Сделки»).
export default function CloudStorageSettings() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/integrations/google-drive");
    if (res.ok) setStatus(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  // Редирект после OAuth-callback: ?gdrive=connected|error — очищаем query,
  // чтобы повторная загрузка страницы не показывала статус снова.
  useEffect(() => {
    const gdrive = searchParams.get("gdrive");
    if (!gdrive) return;
    if (gdrive === "error") setError(t("trades.image.connectError"));
    load();
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/google-drive", { method: "DELETE" });
      if (res.ok) setStatus((s) => (s ? { ...s, connected: false, email: null } : s));
    } finally {
      setBusy(false);
    }
  }

  if (!status?.configured) return null;

  return (
    <div id="integrations" className="card p-5 mb-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <HardDrive size={18} className="text-faint mt-0.5 shrink-0" />
          <div>
            <h3 className="font-medium text-sm">{t("settings.gdrive")}</h3>
            <p className="text-xs text-faint mt-0.5">
              {status.connected
                ? t("settings.gdrive.linkedHint", { email: status.email ?? "" })
                : t("settings.gdriveHint")}
            </p>
          </div>
        </div>
        {status.connected && (
          <span className="inline-flex items-center gap-1.5 text-xs text-profit bg-profit/10 border border-profit/30 rounded-lg px-2.5 py-1 shrink-0">
            <Check size={13} /> {t("settings.gdrive.linked")}
          </span>
        )}
      </div>

      <div className="mt-4">
        {status.connected ? (
          <button
            onClick={disconnect}
            disabled={busy}
            className="px-3 py-2 rounded-lg input-base text-sm hover:border-border-strong disabled:opacity-50"
          >
            {t("settings.gdrive.disconnect")}
          </button>
        ) : (
          <a
            href="/api/integrations/google-drive/connect"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent/15 text-accent text-sm hover:bg-accent/25"
          >
            {t("settings.gdrive.connect")}
          </a>
        )}
      </div>

      {error && (
        <div className="mt-3 text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">{error}</div>
      )}
    </div>
  );
}
