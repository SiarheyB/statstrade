"use client";

import { Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { passwordIssues, passwordStrength, MIN_PASSWORD_LENGTH } from "@/lib/password";

const BAR_COLORS = ["bg-loss", "bg-loss", "bg-amber-500", "bg-accent", "bg-profit"];

// Живой индикатор сложности пароля + чек-лист требований — показывается при
// регистрации/смене пароля. Требования дублируют серверную валидацию
// (lib/password.ts), чтобы пользователь видел, чего не хватает, ДО отправки
// формы, а не только из текста ошибки после неудачной попытки.
export default function PasswordStrengthMeter({ password }: { password: string }) {
  const { t } = useI18n();
  const { score, label } = passwordStrength(password);
  const issues = new Set(passwordIssues(password));

  const requirements: { key: "length" | "letter" | "digit" | "special"; text: string }[] = [
    { key: "length", text: t("auth.password.req.length", { n: MIN_PASSWORD_LENGTH }) },
    { key: "letter", text: t("auth.password.req.letter") },
    { key: "digit", text: t("auth.password.req.digit") },
    { key: "special", text: t("auth.password.req.special") },
  ];

  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              password && i < score ? BAR_COLORS[score] : "bg-border"
            }`}
          />
        ))}
      </div>
      {password && (
        <div className="mt-1 text-[11px] text-faint">{t(`auth.password.strength.${label}`)}</div>
      )}
      <ul className="mt-1.5 space-y-0.5">
        {requirements.map((r) => {
          const met = !issues.has(r.key);
          return (
            <li
              key={r.key}
              className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                met ? "text-profit" : "text-faint"
              }`}
            >
              {met ? <Check size={11} className="shrink-0" /> : <X size={11} className="shrink-0" />}
              {r.text}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
