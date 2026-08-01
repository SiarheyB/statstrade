"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

// <input type="password"> с глазиком справа для показа/скрытия введённого
// текста — переиспользуется во всех формах с паролем (вход, регистрация,
// смена/установка пароля в настройках).
export default function PasswordInput({ className, ...props }: Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={`${className ?? "input-base w-full"} pr-9`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        aria-label={visible ? t("auth.password.hide") : t("auth.password.show")}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-fg transition"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
