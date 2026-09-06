// Отложенные ордера.
//
// Тип `OrderType` и поле `Account.pendingOrders` жили в схеме с первого дня,
// но исполнять их было некому: войти можно было только по рынку. Между тем
// вся торговля по плану — это «поставил на уровень и ушёл»; без отложенных
// ордеров игрок обязан сидеть у экрана, а стоящий у экрана игрок торгует
// хуже. Расписание рынков делает их обязательными вдвойне: в выходные по
// рынку не войти вообще, и заявка — единственный способ подготовиться к
// понедельнику.
import type { Order, PositionSide } from "@/engine/entities/types";

/**
 * Сработал ли ордер при текущей цене.
 *
 * Разница между лимиткой и стопом — сторона, с которой цена подходит к
 * уровню: лимит покупает НИЖЕ рынка (отскок), стоп — ВЫШЕ (пробой). Одну и
 * ту же цену два типа ордера трактуют противоположно, и это не мелочь: на
 * ней держится вся разница между контртрендовой и пробойной торговлей.
 */
export function orderTriggers(order: Order, price: number): boolean {
  if (!Number.isFinite(price)) return false;
  const level = triggerLevel(order);
  if (level == null) return false;
  const buying = order.side === "long";
  if (order.type === "limit") return buying ? price <= level : price >= level;
  if (order.type === "stop" || order.type === "stop_limit") return buying ? price >= level : price <= level;
  return true; // market
}

/** Цена, по которой ордер станет позицией. */
export function triggerLevel(order: Order): number | undefined {
  if (order.type === "limit") return order.limitPrice;
  if (order.type === "stop") return order.stopPrice;
  if (order.type === "stop_limit") return order.limitPrice ?? order.stopPrice;
  return undefined;
}

/**
 * Осмысленна ли заявка при текущей цене.
 *
 * Лимитка на покупку ВЫШЕ рынка исполнилась бы сразу же и по худшей цене,
 * чем рыночный ордер, — это всегда ошибка ввода, а не намерение, поэтому
 * ловим её здесь, а не радуем игрока мгновенным «сработало».
 */
export function validateOrder(
  type: Order["type"],
  side: PositionSide,
  level: number,
  price: number,
): "ok" | "wrong_side" {
  if (!(level > 0) || !(price > 0)) return "wrong_side";
  const buying = side === "long";
  if (type === "limit") return (buying ? level < price : level > price) ? "ok" : "wrong_side";
  if (type === "stop" || type === "stop_limit") return (buying ? level > price : level < price) ? "ok" : "wrong_side";
  return "ok";
}

/**
 * Новый уровень скользящего стопа — или undefined, если тянуть некуда.
 *
 * Стоп ходит только в сторону прибыли: назад он не отступает даже на откате,
 * иначе это уже не защита, а обычный стоп, который просто переставляют.
 */
export function trailStop(
  side: PositionSide,
  price: number,
  trailingPct: number,
  currentStop: number | undefined,
): number | undefined {
  if (!(trailingPct > 0) || !(price > 0)) return undefined;
  const distance = price * (trailingPct / 100);
  const candidate = side === "long" ? price - distance : price + distance;
  if (currentStop == null) return candidate;
  const better = side === "long" ? candidate > currentStop : candidate < currentStop;
  return better ? candidate : undefined;
}
