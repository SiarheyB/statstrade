import { serverError, redirectLocal, tooManyRequests } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { startDemoSession } from "@/lib/demoSession";

// Первый заход создаёт демо-пользователя и сеет ~140 сделок — это несколько
// секунд, дальше вход мгновенный.
export const maxDuration = 60;

// Вход в демо. POST, а не ссылка: заход меняет состояние (выдаёт cookie), и
// префетч браузера не должен его запускать. Форма на лендинге отправляется
// обычным submit — демо работает и без JS.
export async function POST(req: Request) {
  // Роут анонимный и на каждый вызов пишет в БД (upsert пользователя, поиск
  // счёта, раз в сутки — пересев ~140 сделок при maxDuration=60). Без лимита
  // это самый дешёвый способ нагрузить сервер: пять запросов в минуту с адреса
  // человеку хватит с запасом, а циклу — нет.
  const rl = rateLimit(`demo:${clientIp(req)}`, 5, 10 * 60_000);
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  try {
    await startDemoSession();
    return redirectLocal("/dashboard");
  } catch (err) {
    return serverError((err as Error).message);
  }
}
