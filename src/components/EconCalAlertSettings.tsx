"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { BellRing, Play } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { CALENDAR_CURRENCIES, flagFor } from "@/lib/econcalFlags";
import {
  ALERT_DEMO_EVENT,
  ALERT_IMPACTS,
  DEFAULT_ALERT_SETTINGS,
  LEAD_OPTIONS,
  loadAlertSettings,
  saveAlertSettings,
  type AlertImpact,
  type EconAlertSettings,
} from "@/lib/econcalAlerts";

const IMPACT_DOT: Record<AlertImpact, string> = {
  high: "bg-loss",
  medium: "bg-warn",
  low: "bg-faint",
};

type Permission = "default" | "granted" | "denied" | "unsupported";

export default function EconCalAlertSettings() {
  // До первого эффекта показываем дефолты: localStorage на сервере не прочесть,
  // а разметка должна совпасть с серверной (см. I18nProvider — тот же приём).
  const [settings, setSettings] = useState<EconAlertSettings>(DEFAULT_ALERT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [permission, setPermission] = useState<Permission>("default");
  const { t } = useI18n();

  useEffect(() => {
    setSettings(loadAlertSettings());
    setReady(true);
    setPermission(
      typeof Notification === "undefined" ? "unsupported" : (Notification.permission as Permission),
    );
  }, []);

  const update = (patch: Partial<EconAlertSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveAlertSettings(next);
  };

  // Списки-переключатели: последний выбранный пункт не снимаем — пустой список
  // означал бы «молчать», а для этого есть главный выключатель.
  const toggleImpact = (im: AlertImpact) => {
    const has = settings.impacts.includes(im);
    if (has && settings.impacts.length === 1) return;
    update({
      impacts: has ? settings.impacts.filter((x) => x !== im) : [...settings.impacts, im],
    });
  };

  const toggleLead = (lead: number) => {
    const has = settings.leads.includes(lead);
    if (has && settings.leads.length === 1) return;
    update({
      leads: (has ? settings.leads.filter((x) => x !== lead) : [...settings.leads, lead]).sort(
        (a, b) => b - a,
      ),
    });
  };

  const toggleCurrency = (cur: string) => {
    update({
      currencies: settings.currencies.includes(cur)
        ? settings.currencies.filter((x) => x !== cur)
        : [...settings.currencies, cur],
    });
  };

  const askPermission = async () => {
    if (typeof Notification === "undefined") return;
    try {
      const res = await Notification.requestPermission();
      setPermission(res as Permission);
      if (res === "granted") update({ system: true });
    } catch {
      // Отказ или недоступный API — состояние обновится само при перезаходе.
    }
  };

  const impactList = ALERT_IMPACTS.filter((i) => settings.impacts.includes(i))
    .map((i) => t(`econcal.impact.${i}`).toLowerCase())
    .join(", ");
  const leadList = [...settings.leads]
    .sort((a, b) => b - a)
    .map((l) => String(l))
    .join(" / ");
  const curList = settings.currencies.length
    ? settings.currencies.join(", ")
    : t("econcalAlerts.allCurrencies");

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-medium text-sm flex items-center gap-2">
            <BellRing size={15} className="text-accent" />
            {t("econcalAlerts.title")}
          </h3>
          <p className="text-xs text-faint mt-0.5 max-w-md">{t("econcalAlerts.hint")}</p>
        </div>
        <Switch on={settings.enabled} onClick={() => update({ enabled: !settings.enabled })} />
      </div>

      <div
        className={clsx(
          "transition-opacity duration-300",
          settings.enabled ? "opacity-100" : "opacity-40 pointer-events-none select-none",
        )}
        aria-hidden={!settings.enabled}
      >
        <Row label={t("econcalAlerts.impacts")} hint={t("econcalAlerts.impactsHint")}>
          {ALERT_IMPACTS.map((im) => (
            <Chip key={im} on={settings.impacts.includes(im)} onClick={() => toggleImpact(im)}>
              <span className={clsx("h-2 w-2 rounded-full", IMPACT_DOT[im])} />
              {t(`econcal.impact.${im}`)}
            </Chip>
          ))}
        </Row>

        <Row label={t("econcalAlerts.leads")} hint={t("econcalAlerts.leadsHint")}>
          {LEAD_OPTIONS.map((lead) => (
            <Chip key={lead} on={settings.leads.includes(lead)} onClick={() => toggleLead(lead)}>
              <span className="tabular-nums">{t("econcalAlerts.leadMinutes", { m: lead })}</span>
            </Chip>
          ))}
        </Row>

        <Row label={t("econcalAlerts.currencies")} hint={t("econcalAlerts.currenciesHint")}>
          {CALENDAR_CURRENCIES.map((cur) => (
            <Chip key={cur} on={settings.currencies.includes(cur)} onClick={() => toggleCurrency(cur)}>
              <span>{flagFor(cur)}</span>
              {cur}
            </Chip>
          ))}
        </Row>

        <Row label={t("econcalAlerts.sound")} hint={t("econcalAlerts.soundHint")}>
          <Switch on={settings.sound} onClick={() => update({ sound: !settings.sound })} />
        </Row>

        <Row label={t("econcalAlerts.system")} hint={t("econcalAlerts.systemHint")}>
          {permission === "granted" ? (
            <Switch on={settings.system} onClick={() => update({ system: !settings.system })} />
          ) : permission === "denied" ? (
            <span className="text-xs text-faint">{t("econcalAlerts.blocked")}</span>
          ) : permission === "unsupported" ? (
            <span className="text-xs text-faint">{t("econcalAlerts.unsupported")}</span>
          ) : (
            <button
              onClick={askPermission}
              className="px-3 py-1.5 rounded-lg text-xs input-base hover:border-border-strong"
            >
              {t("econcalAlerts.allow")}
            </button>
          )}
        </Row>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2/70 border border-border px-3.5 py-2.5">
          <p className="text-xs text-muted min-w-0">
            {ready
              ? t("econcalAlerts.summary", {
                  impacts: impactList,
                  leads: leadList,
                  currencies: curList,
                })
              : " "}
          </p>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent(ALERT_DEMO_EVENT))}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition"
          >
            <Play size={12} />
            {t("econcalAlerts.demo")}
          </button>
        </div>

        <p className="text-[11px] text-faint mt-2">{t("econcalAlerts.deviceNote")}</p>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3.5 border-t border-border mt-3.5 first:mt-4">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        <div className="text-xs text-faint mt-0.5 max-w-xs">{hint}</div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 justify-end">{children}</div>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={clsx(
        "px-2.5 py-1 rounded-full text-xs border transition inline-flex items-center gap-1.5",
        on
          ? "bg-accent/15 text-accent border-accent/30"
          : "text-muted border-border hover:text-fg hover:border-border-strong",
      )}
    >
      {children}
    </button>
  );
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={clsx(
        "relative inline-flex h-6 w-11 items-center rounded-full transition shrink-0",
        on ? "bg-accent" : "bg-surface-2 border border-border",
      )}
    >
      <span
        className={clsx(
          "inline-block h-4 w-4 rounded-full bg-white transition",
          on ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}
