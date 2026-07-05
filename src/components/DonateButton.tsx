"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { HeartHandshake, X, Copy, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

type Wallet = { id: string; network: string; coin: string; address: string; qr: string };

// Кнопка «Донат» в меню + модалка со списком кошельков (сеть, адрес, QR).
// Список грузится лениво при открытии — обычно юзер её не открывает никогда.
export default function DonateButton({ onOpen }: { onOpen?: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function openModal() {
    onOpen?.();
    setOpen(true);
    if (wallets) return; // уже загружено
    setLoading(true);
    try {
      const res = await fetch("/api/donate");
      if (res.ok) setWallets((await res.json()).wallets ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function copy(w: Wallet) {
    try {
      await navigator.clipboard.writeText(w.address);
      setCopiedId(w.id);
      setTimeout(() => setCopiedId((id) => (id === w.id ? null : id)), 1500);
    } catch {
      // clipboard недоступен — тихо игнорируем
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted hover:text-accent hover:bg-surface-2 transition"
      >
        <HeartHandshake size={18} />
        {t("nav.donate")}
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md rounded-[0.85rem] border border-border-strong bg-surface shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 text-faint hover:text-fg"
              aria-label="close"
            >
              <X size={18} />
            </button>
            <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <HeartHandshake size={18} className="text-accent" />
              {t("donate.title")}
            </h2>
            <p className="text-sm text-muted mb-4">{t("donate.subtitle")}</p>

            {loading ? (
              <div className="text-sm text-faint">{t("common.loading")}</div>
            ) : !wallets || wallets.length === 0 ? (
              <div className="text-sm text-faint">{t("donate.empty")}</div>
            ) : (
              <div className="space-y-4">
                {wallets.map((w) => (
                  <div key={w.id} className="rounded-xl border border-border p-4 flex flex-col items-center gap-3">
                    <div className="text-sm font-medium">
                      {w.coin} · {w.network}
                    </div>
                    <Image
                      src={w.qr}
                      alt={`${w.coin} ${w.network} QR`}
                      width={180}
                      height={180}
                      unoptimized
                      className="rounded-lg bg-white p-2"
                    />
                    <div className="w-full flex items-center gap-2">
                      <code className="flex-1 min-w-0 truncate text-xs bg-surface-2 rounded-lg px-2.5 py-2 font-mono">
                        {w.address}
                      </code>
                      <button
                        onClick={() => copy(w)}
                        className="input-base p-2 shrink-0 hover:border-border-strong"
                        title={t("donate.copy")}
                      >
                        {copiedId === w.id ? <Check size={14} className="text-profit" /> : <Copy size={14} />}
                      </button>
                    </div>
                    {copiedId === w.id && <div className="text-xs text-profit -mt-1">{t("donate.copied")}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
