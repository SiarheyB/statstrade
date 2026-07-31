"use client";

import { useEffect, useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

// Модальное окно поверх страницы с превью изображения сделки. Открывается
// кликом по ссылке в таблице сделок, закрывается по клику на фон, крестику
// или Escape — новая вкладка НЕ открывается.
export default function ImagePreviewModal({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div className="relative max-w-3xl max-h-[85vh] w-full" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute -top-3 -right-3 bg-bg border border-border rounded-full p-1.5 text-fg hover:text-accent shadow-lg"
        >
          <X size={16} />
        </button>
        {failed ? (
          <div className="card p-8 text-center text-sm text-muted flex flex-col items-center gap-2">
            <AlertTriangle size={20} className="text-loss" />
            {t("trades.image.unavailable")}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            onError={() => setFailed(true)}
            className="max-w-full max-h-[85vh] rounded-lg object-contain mx-auto shadow-2xl"
          />
        )}
      </div>
    </div>
  );
}
