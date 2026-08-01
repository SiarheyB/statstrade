// Единая политика пароля — используется и на сервере (валидация в
// register/password роутах), и на клиенте (живой индикатор сложности,
// подсказка при регистрации). Не зависит от zod/DOM, чтобы быть безопасно
// импортируемой в оба контекста.

export const MIN_PASSWORD_LENGTH = 6;

const UPPERCASE_RE = /[A-ZА-ЯЁ]/;
const LOWERCASE_RE = /[a-zа-яё]/;
const DIGIT_RE = /\d/;
// Спецсимвол — всё, что не буква/цифра/пробел (пробел не считаем спецсимволом,
// чтобы не поощрять "пароль с пробелом в конце" как обход требования).
const SPECIAL_RE = /[^a-zA-Zа-яА-ЯёЁ0-9\s]/;

export type PasswordIssue = "length" | "uppercase" | "lowercase" | "digit" | "special";

// Список непройденных требований — пустой массив = пароль валиден.
export function passwordIssues(pw: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (pw.length < MIN_PASSWORD_LENGTH) issues.push("length");
  if (!UPPERCASE_RE.test(pw)) issues.push("uppercase");
  if (!LOWERCASE_RE.test(pw)) issues.push("lowercase");
  if (!DIGIT_RE.test(pw)) issues.push("digit");
  if (!SPECIAL_RE.test(pw)) issues.push("special");
  return issues;
}

export function isValidPassword(pw: string): boolean {
  return passwordIssues(pw).length === 0;
}

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: "veryWeak" | "weak" | "fair" | "good" | "strong";
};

// Индикатор сложности для UI — независим от isValidPassword: даже пароль,
// уже прошедший минимальные требования, может быть длиннее/разнообразнее
// и получить более высокий score. Не пытается быть криптографически точным
// (как zxcvbn) — простая эвристика для визуальной обратной связи.
export function passwordStrength(pw: string): PasswordStrength {
  if (!pw) return { score: 0, label: "veryWeak" };
  let score = 0;
  if (pw.length >= MIN_PASSWORD_LENGTH) score++;
  if (pw.length >= 10) score++;
  if (UPPERCASE_RE.test(pw) && LOWERCASE_RE.test(pw) && DIGIT_RE.test(pw)) score++;
  if (SPECIAL_RE.test(pw)) score++;
  const clamped = Math.min(4, score) as PasswordStrength["score"];
  const labels: PasswordStrength["label"][] = ["veryWeak", "weak", "fair", "good", "strong"];
  return { score: clamped, label: labels[clamped] };
}
