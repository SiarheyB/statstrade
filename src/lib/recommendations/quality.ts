/**
 * quality.ts — отбор «готовых» уровней: не всё, что рядом с ценой, годится
 * для торговли. Метрики и пороги взяты из docs/trade/алгоритм.pdf и
 * docs/trade/твх.pdf, слайд «Пробой» (обязательные условия и раздел
 * «минусы — чего не должно быть»):
 *
 *   ОБЯЗАТЕЛЬНО: низкая волатильность, «пустота» в пробойной плоскости,
 *   УРОВЕНЬ БЕЗ ЗАПИЛОВ, плавный подход, запас хода.
 *   МИНУСЫ: запил, глубокий ЛП (стопы уже сняты), слом поджатия,
 *   подход на больших барах, далёкое закрытие D1 (0.5+ ATR до уровня).
 *
 * Плюс «предпосылки к отбою» (алгоритм.pdf, стр. 26): проторгованная зона за
 * уровнем — «зона заражённости»; если впереди проторгованная область,
 * инструменту тяжело пробить уровень с первого раза.
 *
 * Здесь считаются ИЗМЕРИМЫЕ по OHLC величины; решение «пропустить/отсеять»
 * принимает passesQualityGate ниже, а не спрятанный скоринг.
 */

import type { DailyCandle } from "./levels";

export type LevelSide = "above" | "below"; // уровень выше или ниже текущей цены

export interface LevelQuality {
  side: LevelSide;
  /** Запил: сколько раз закрытия перекладывались через уровень в окне анализа. */
  crossings: number;
  /** Сколько раз уровень прокалывался с возвратом (ложные пробои) в прошлом. */
  falseBreakouts: number;
  /** Глубина самого глубокого прокола, в ATR. 0 — проколов не было. */
  deepestFalseBreakoutAtr: number;
  /** Самая длинная серия проколов ПОДРЯД (см. maxConsecutivePierces). */
  consecutiveFalseBreakouts: number;
  /**
   * Глубина прокола на САМОМ ПОСЛЕДНЕМ закрытом баре, в ATR (0 — не прокалывал).
   * Стоит отдельно от deepestFalseBreakoutAtr, который считается по истории
   * БЕЗ последнего бара: у свежего прокола принципиально нет ни одного дня
   * после него, а значит нет и подтверждения, что уровень выстоял.
   */
  lastBarPierceAtr: number;
  /** Доля баров окна, заходивших в зону сразу ЗА уровнем («заражённость»). */
  contamination: number;
  /** Запас хода: до следующего уровня за пробойной плоскостью, в ATR. */
  runwayAtr: number;
  /** Насколько вчерашний день закрылся близко к уровню, в ATR. */
  closeDistanceAtr: number;
  /** Дотянулся ли вчерашний бар до уровня (хай/лоу в пределах допуска). */
  touched: boolean;
  /**
   * Насколько хай/лоу вчерашнего бара НЕ дотянулся до уровня, в ATR (та же
   * величина, что стоит за touched, но со знаком и не булева: отрицательная,
   * если бар уже пробил уровень). Для ЛП это ключевая метрика подхода:
   * конспект требует, чтобы вчера бар остановился ДАЛЕКО (обычно ~1×ATR) от
   * уровня — тогда сегодняшний бар должен пройти весь этот путь, проколоть
   * уровень и вернуться, а не просто чуть подрасти рядом с ним.
   */
  approachGapAtr: number;
  /** Размер последних баров подхода относительно ATR. */
  approachRatio: number;
  /** Был ли гэп в сторону уровня среди последних баров. */
  gapApproach: boolean;
  /**
   * Чистое смещение цены за последние fastApproachWindow баров, в ATR —
   * "довгий безвідкатний рух" из конспекта. В отличие от approachRatio
   * (средний размер только 3 последних баров, легко ложно срабатывает на
   * шумном хвосте долгого пологого "закруглення" к уровню — плюс для
   * ПРОБОЯ, а не предпосылка ЛП), это смотрит на весь путь: медленный
   * многодневный подход даёт маленькое netMove, даже если пара последних
   * баров случайно крупнее обычного.
   */
  approachNetMoveAtr: number;
  /**
   * Насколько последний закрытый бар ОТДАЛИЛСЯ от уровня по сравнению с
   * предыдущим, в ATR (0 и меньше — подход продолжался). Меряется по той
   * границе бара, которой он идёт к уровню: лоу для уровня снизу, хай для
   * уровня сверху.
   *
   * Для ЛП это признак «подход прерван»: цена летела к уровню, но вчера
   * развернулась и пошла обратно — дальше вероятнее накопление, а не рывок
   * до уровня с проколом и возвратом за один сегодняшний бар.
   */
  turnAwayAtr: number;
  /**
   * Насколько цена уже уходила ЗАКРЫТИЕМ за уровень ПОСЛЕ его образования, в
   * ATR (0 — не уходила). Свежий хвост в BREACH_FRESH_BARS баров не считается:
   * там пробой либо ещё не подтверждён, либо это ровно тот пробой, ради
   * которого существует ЛП2Б.
   *
   * Трейдер называет такой уровень закрытым: откат, выше которого потом
   * закрылись, поглощён следующим движением, и ЛП от него уже не работает —
   * рабочей остаётся следующая, ещё не снятая точка структуры (SFPUSDT: откат
   * 0.2912 от 22.05 перекрыт закрытиями 30-31.05, рабочий уровень — 0.3132).
   */
  breachedAfterFormedAtr: number;
  /**
   * Сколько ЗНАЧИМЫХ уровней стоит между вчерашним закрытием и этим уровнем.
   * Для ЛП это про реализуемость пути: сегодняшний бар должен дойти до
   * уровня одним махом, а каждый уровень по дороге — место, где цена
   * тормозит или разворачивается (ZHIPUUSDT: до отката 107.05 идти сквозь
   * местную опору 126.50 и слом 111.95).
   */
  blockingLevels: number;
}

export interface QualityThresholds {
  /** Окно «левой стороны» (баров), в котором ищем запилы и проколы уровня. */
  window: number;
  /** Окно (баров) для проверки зоны за уровнем на проторговку. */
  contaminationWindow: number;
  /** Прокол мельче этого (в ATR) — рыночный шум, за ложный пробой не считаем. */
  minPierceAtr: number;
  /** Мёртвая зона вокруг уровня (в ATR): закрытия внутри неё не считаем переходом. */
  deadbandAtr: number;
  /** Ширина зоны за уровнем, которую проверяем на проторговку, в ATR. */
  contaminationZoneAtr: number;
  /** Допуск «бар дотянулся до уровня», в ATR. */
  touchToleranceAtr: number;
  maxCrossings: number;
  maxFalseBreakouts: number;
  /** Сколько проколов ПОДРЯД ещё допустимо (2 подряд — уровень распилен). */
  maxConsecutiveFalseBreakouts: number;
  /**
   * Порог глубины для проколов В СЕРИИ — заметно мягче minPierceAtr. Одиночный
   * прокол в истории имеет смысл считать только если он глубже шума, но для
   * распила важен сам факт: уровень пройден и брошен два дня подряд. Реальный
   * пример (GEV, ATR 36.5): хай 14.08 ушёл за уровень на 0.094×ATR, хай 15.08 —
   * на 0.066×ATR; при общем пороге 0.08 второй бар считался «шумом», и распил
   * проходил гейт. Конспект относит к «неглубокому ЛП» проколы до 0.10-0.15×ATR
   * — то есть оба этих бара полноценные ЛП, а не шум.
   */
  consecutivePierceAtr: number;
  /** Прокол глубже этого (в ATR) — «глубокий ЛП», стопы уже сняты. */
  deepFalseBreakoutAtr: number;
  /** Порог глубины для НЕПОДТВЕРЖДЁННОГО прокола — вчерашнего (см. lastBarPierceAtr). */
  unconfirmedPierceAtr: number;
  maxContamination: number;
  minRunwayAtr: number;
  maxCloseDistanceAtr: number;
  /**
   * Для ЛП: вчерашний хай/лоу должен НЕ дотягивать до уровня минимум на
   * столько ATR — сегодняшний бар обязан пройти этот путь целиком, проколоть
   * уровень и вернуться, а не просто закрыться рядом. Противоположность
   * maxCloseDistanceAtr (который про пробой: там нужно закрытие ВПЛОТНУЮ).
   */
  minFalseBreakoutApproachGapAtr: number;
  /**
   * Для ЛП: насколько последний бар может отойти от уровня относительно
   * предыдущего (см. turnAwayAtr), прежде чем подход считается прерванным.
   */
  maxTurnAwayAtr: number;
  /**
   * Для ЛП: насколько глубоко цена могла закрываться за уровнем после его
   * образования (см. breachedAfterFormedAtr), прежде чем считать уровень
   * снятым. Тот же допуск шума, что у касания.
   */
  maxBreachAfterFormedAtr: number;
  /** Хвост баров, в котором закрытие за уровнем ещё не «уровень снят». */
  breachFreshBars: number;
  /** Для ЛП: сколько значимых уровней допускается на пути до уровня. */
  maxBlockingLevels: number;
  /** Подход «на малых барах» — средний диапазон не больше этого × ATR. */
  smallBarsRatio: number;
  /** Подход «на больших барах» — средний диапазон не меньше этого × ATR. */
  bigBarsRatio: number;
  /** Сколько баров смотрим для approachNetMoveAtr (см. LevelQuality). */
  fastApproachWindow: number;
  /** ЛП: минимальное чистое смещение за fastApproachWindow баров, в ATR —
   *  порог "довгого безвідкатного руху", отделяющий настоящий быстрый заход
   *  от многодневного пологого закругления к уровню. */
  minFastApproachNetMoveAtr: number;
}

// Пороги откалиброваны на реальной выдаче Binance USDT-M (526 пар): из ~2000
// уровней рядом с ценой гейт оставляет полтора-два десятка — то есть короткий
// список готовых инструментов, а не каталог рынка.
// Предельный обратный путь у ЛП2Б: maxCloseBeyondAtr + minPierceAtr из
// falseBreakout2b.ts (0.35 + 0.08). Дублируется числом, а не импортом, чтобы quality.ts не
// зависел от детектора (импорт в обратную сторону уже есть).
const DEFAULT_2B_MAX_RETURN_ATR = 0.43;

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  // Запил смотрим по недавней истории (~3 месяца): «чистота слева» — про то,
  // как уровень вёл себя на подходе, а не про всю историю инструмента.
  window: 60,
  contaminationWindow: 120,
  // Конспект: "неглибокий ЛП це розмір стопа (до 10-15% АТР)" — порог шума
  // должен быть НИЖЕ верхней границы "неглубокого" ЛП, иначе как раз
  // неглубокие проколы (самые частые и самые говорящие) тонут в шуме и
  // никогда не попадают в falseBreakouts. Раньше здесь стояло 0.25 — выше
  // всего диапазона "неглубокого" ЛП по документу.
  minPierceAtr: 0.08,
  deadbandAtr: 0.1,
  contaminationZoneAtr: 1,
  touchToleranceAtr: 0.25,
  // «Уровень без запилов»: одна перекладка через уровень ещё допустима,
  // две и больше — уже распил.
  maxCrossings: 1,
  maxFalseBreakouts: 1,
  // Один прокол — снятые стопы, это даже плюс. Два ПОДРЯД (вчера проколол и
  // сегодня снова) — уровень уже не держит, торговать его нельзя.
  maxConsecutiveFalseBreakouts: 1,
  // Почти любой выход за уровень с возвратом: важен факт, а не глубина.
  // Ниже — уже дрожание цены на тик от уровня.
  consecutivePierceAtr: 0.02,
  // «Глубокий ЛП» — стопы за уровнем уже сняты, энергии на пробой меньше.
  deepFalseBreakoutAtr: 0.75,
  // Тот же смысл, но строже — для прокола, случившегося ВЧЕРА (на последнем
  // закрытом баре). Порог ниже deepFalseBreakoutAtr намеренно: у старого
  // прокола есть дни после него, и если уровень их выстоял, не пустив цену
  // за себя, — прокол оказался разведкой, стопы сняты, пробой впереди. У
  // вчерашнего прокола такого дня нет вовсе, подтверждать нечем, и заход в
  // пробой означал бы ставку на импульс, который только что выдохся. Конспект
  // называет неглубоким ЛП размер стопа (10-15% ATR); берём вдвое мягче, чтобы
  // не резать нормальные проколы-разведки на границе шума.
  unconfirmedPierceAtr: 0.3,
  // «Пустота в пробойной плоскости»: за уровнем почти не торговали.
  maxContamination: 0.1,
  minRunwayAtr: 1,
  // Док: далёкое закрытие — 0.5+ ATR до уровня. Нам нужен день, который
  // закрылся ВПЛОТНУЮ, поэтому берём вдвое строже.
  maxCloseDistanceAtr: 0.25,
  // Для ЛП — обратное требование: вчера бар должен был остановиться далеко
  // ОТ уровня, целый ATR, чтобы сегодняшний бар делал весь путь + прокол +
  // возврат за один день (а не просто чуть доставал до уровня).
  minFalseBreakoutApproachGapAtr: 1,
  // Отскок в четверть ATR — ещё дрожание внутри подхода; больше — цена уже
  // развернулась от уровня. Тот же допуск, что у «касания» уровня.
  maxTurnAwayAtr: 0.25,
  maxBreachAfterFormedAtr: 0.25,
  // Столько же баров, сколько freshBreakDirection в breakoutSignals считает
  // пробой свежим: вчерашний уход за уровень — это сетап, а не история.
  breachFreshBars: 10,
  // Ни одного: путь до уровня должен быть свободен. Уровень по дороге — это
  // место, где сегодняшний бар с большой вероятностью и остановится.
  maxBlockingLevels: 0,
  smallBarsRatio: 0.8,
  bigBarsRatio: 1.2,
  // Разделяет реальный "довгий безвідкатний рух" от многодневного пологого
  // закругления к уровню (плюс для ПРОБОЯ, не для ЛП). На реальной выдаче
  // (10 инструментов, размеченных вручную) чистое разделение: у ложных
  // срабатываний ("закругление") netMove за 10 баров не превышал ~1.1×ATR,
  // у настоящих быстрых подходов — не ниже ~2.3×ATR. Порог 1.5 — с запасом
  // посередине.
  fastApproachWindow: 10,
  minFastApproachNetMoveAtr: 1.5,
};

// Для local_stop (см. levels.ts): уровню всего 1-10 дней, а не месяцы. Гейт
// на DEFAULT_THRESHOLDS.window/contaminationWindow (60/120 дней) смотрел бы на
// историю, которая ЗАВЕДОМО старше самого уровня — включая, например, обвал,
// после которого уровень и образовался, засчитывая его как "запил"/"грязную
// зону", хотя тот вообще не имеет отношения к этой конкретной опорной точке.
// Остальные пороги те же — сама методика оценки чистоты не меняется, меняется
// только окно, в котором её применять.
export const LOCAL_THRESHOLDS: QualityThresholds = {
  ...DEFAULT_THRESHOLDS,
  window: 10,
  contaminationWindow: 15,
  // Линия местной опоры проведена ПО ЛОУ (или хаю) соседнего бара, поэтому
  // хвосты рядом с ней заходят за уровень на доли ATR просто по построению.
  // С общим порогом серии (0.02×ATR) любое поджатие к такому уровню читалось
  // как распил: у ZHIPUUSDT проколы 0.03 и 0.06×ATR давали «два подряд».
  // Считаем серией только настоящие проколы.
  consecutivePierceAtr: DEFAULT_THRESHOLDS.minPierceAtr,
  // И то же смягчение для «закрылись вплотную»: у местной опоры закрытия
  // стоят в середине диапазона накопления, а не на самой линии. Берём тот же
  // порог, по которому фактор close_near_level считает закрытие близким —
  // иначе карточка сама себе противоречит: фактор «за», а гейт отклоняет.
  maxCloseDistanceAtr: 0.5,
};

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Сторона закрытия относительно уровня с мёртвой зоной: закрытия «на уровне»
// не считаем ни одной из сторон, иначе дрожание цены вокруг уровня выглядело
// бы как десятки перекладок.
function sideOfClose(close: number, levelPrice: number, deadband: number): 1 | -1 | 0 {
  if (close > levelPrice + deadband) return 1;
  if (close < levelPrice - deadband) return -1;
  return 0;
}

/**
 * Запил: сколько раз закрытия перекладывались через уровень. Чистый уровень —
 * это уровень, который цена уважала: подходила и уходила, а не пилила его
 * туда-сюда.
 */
export function countCrossings(candles: DailyCandle[], levelPrice: number, atr: number, deadbandAtr: number): number {
  const deadband = atr * deadbandAtr;
  let crossings = 0;
  let prevSide: 1 | -1 | 0 = 0;
  for (const c of candles) {
    const side = sideOfClose(c.c, levelPrice, deadband);
    if (side === 0) continue;
    if (prevSide !== 0 && side !== prevSide) crossings += 1;
    prevSide = side;
  }
  return crossings;
}

/**
 * Проколы уровня с возвратом: бар вышел за уровень хаем/лоу, но закрылся
 * обратно (док: «цена не может закрыться выше хая или ниже лоу предыдущего
 * дня»). Глубина прокола — на сколько ATR ушёл экстремум за уровень; глубокий
 * прокол значит, что стопы за уровнем уже сняты и энергии для пробоя меньше.
 */
export function findPierces(
  candles: DailyCandle[],
  levelPrice: number,
  atr: number,
  minPierceAtr: number,
): { count: number; deepestAtr: number } {
  const minPierce = atr * minPierceAtr;
  let count = 0;
  let deepestAtr = 0;
  // Сторону подхода берём по ПРЕДЫДУЩЕМУ закрытию: иначе бар, который пришёл
  // снизу и закрылся выше уровня (то есть пробил его), выглядел бы как прокол
  // сверху — его лоу ведь остался под уровнем. Сравнение НЕ строгое (>=/<=):
  // предыдущее закрытие часто оказывается РОВНО на уровне — например, когда
  // сам уровень сформирован по недавнему экстремуму, и цена туда же
  // вернулась (реальный случай TZAUSDT: закрытие 14.08 легло точно на
  // уровень 36.39, и строгое `>` делало следующий, более глубокий прокол
  // 15.08 невидимым для гейта). Ровное закрытие на уровне — это ещё не
  // прокол сам по себе, но однозначно НЕ смена стороны на противоположную.
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const from = candles[i - 1].c;
    const pierceUp = from <= levelPrice && c.h > levelPrice + minPierce && c.c < levelPrice;
    const pierceDown = from >= levelPrice && c.l < levelPrice - minPierce && c.c > levelPrice;
    if (!pierceUp && !pierceDown) continue;
    count += 1;
    const depth = (pierceUp ? c.h - levelPrice : levelPrice - c.l) / atr;
    if (depth > deepestAtr) deepestAtr = depth;
  }
  return { count, deepestAtr };
}

/**
 * Самая длинная серия ПОДРЯД идущих проколов уровня. Два соседних бара, каждый
 * из которых вышел за уровень и вернулся, — это уже не «один аккуратный ЛП, на
 * котором сняли стопы», а распил: уровень перестал держать, цена ходит сквозь
 * него туда-сюда каждый день. Один такой бар допустим (и даже полезен —
 * стопы сняты), два подряд — сетап уже не торгуем.
 *
 * В отличие от falseBreakouts, считается по окну ВМЕСТЕ с последним закрытым
 * баром: именно свежая пара «вчера проколол — сегодня снова проколол» и есть
 * признак распила, а он весь лежит в самом конце окна.
 *
 * Закрытие бара для этой серии проверяем НЕ на полный реклейм уровня
 * (строго на другой стороне), а лишь на то, что бар НЕ подтвердил пробой —
 * закрылся не дальше деадбенда за уровнем. Реальный случай TZAUSDT: бар
 * проколол уровень 36.39 (лоу 36.32) и закрылся РОВНО на нём (36.39, не
 * выше) — по факту уровень удержал, следующий день пробил уже глубже
 * (лоу 36.17). Требование строго `c.c > levelPrice` считало бы такой бар
 * не проколом вовсе, и серия из двух дней подряд теряла бы первый день.
 */
export function maxConsecutivePierces(
  candles: DailyCandle[],
  levelPrice: number,
  atr: number,
  minPierceAtr: number,
  deadbandAtr: number,
): number {
  const minPierce = atr * minPierceAtr;
  const deadband = atr * deadbandAtr;
  let best = 0;
  let streak = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const from = candles[i - 1].c;
    // Не строгое сравнение — см. комментарий в findPierces: закрытие ровно на
    // уровне не должно "гасить" распознавание стороны подхода.
    const pierceUp = from <= levelPrice && c.h > levelPrice + minPierce && c.c < levelPrice + deadband;
    const pierceDown = from >= levelPrice && c.l < levelPrice - minPierce && c.c > levelPrice - deadband;
    if (pierceUp || pierceDown) {
      streak += 1;
      if (streak > best) best = streak;
    } else {
      streak = 0;
    }
  }
  return best;
}

/**
 * Заражённость: доля баров окна, которые торговались в зоне сразу ЗА уровнем.
 * 0 — за уровнем «пустота» (док: чистая зона после прохождения уровня),
 * высокое значение — там уже была борьба, пробить с первого раза тяжело.
 */
export function contaminationRatio(
  candles: DailyCandle[],
  levelPrice: number,
  atr: number,
  side: LevelSide,
  zoneAtr: number,
  offsetAtr = 0.1,
): number {
  if (candles.length === 0) return 0;
  const zone = atr * zoneAtr;
  // Зона начинается СТРОГО за уровнем: бары, которые лишь упираются хаем в
  // сам уровень, — это подход к нему, а не проторговка за ним.
  const offset = atr * offsetAtr;
  const [lo, hi] =
    side === "above" ? [levelPrice + offset, levelPrice + zone] : [levelPrice - zone, levelPrice - offset];
  const inside = candles.filter((c) => c.h >= lo && c.l <= hi).length;
  return inside / candles.length;
}

/**
 * Запас хода: до ближайшего ЗНАЧИМОГО уровня за пробойной плоскостью, в ATR.
 * Если дальше уровней нет — Infinity («пустота», ходу ничего не мешает).
 * Считать по всем найденным уровням бессмысленно: детектор находит их
 * десятками на инструмент, и «следующий» всегда оказывается вплотную.
 */
export function runwayAtr(levelPrice: number, significantLevels: number[], atr: number, side: LevelSide): number {
  if (atr <= 0) return 0;
  const beyond = significantLevels.filter((p) => (side === "above" ? p > levelPrice : p < levelPrice));
  if (beyond.length === 0) return Infinity;
  const nearest = beyond.reduce((best, p) => (Math.abs(p - levelPrice) < Math.abs(best - levelPrice) ? p : best));
  return Math.abs(nearest - levelPrice) / atr;
}

// Чистое смещение цены за последние `window` баров, в ATR — см. LevelQuality.
// approachNetMoveAtr. Не привязано к направлению уровня: это просто модуль
// пройденного пути, конспект говорит "довгий безвідкатний рух" безотносительно
// к тому, куда именно он идёт.
function netMoveAtr(candles: DailyCandle[], atr: number, window: number): number {
  if (atr <= 0 || candles.length === 0) return 0;
  const win = candles.slice(-window);
  return Math.abs(win[win.length - 1].c - win[0].o) / atr;
}

// Гэп в сторону уровня среди последних баров: открытие оторвалось от
// предыдущего закрытия и сдвинуло цену к уровню (для ЛП — быстрый подход).
function hasGapApproach(candles: DailyCandle[], levelPrice: number, atr: number, minGapAtr = 0.3): boolean {
  const tail = candles.slice(-3);
  for (let i = 1; i < tail.length; i++) {
    const gap = tail[i].o - tail[i - 1].c;
    if (Math.abs(gap) < atr * minGapAtr) continue;
    const movedTowards = Math.abs(tail[i].o - levelPrice) < Math.abs(tail[i - 1].c - levelPrice);
    if (movedTowards) return true;
  }
  return false;
}

// Значимые уровни, стоящие между ценой и целевым уровнем. Допуск в четверть
// ATR у обеих границ: уровень, слипшийся с целевым или стоящий прямо под
// текущей ценой, дорогу не перегораживает.
function countBlockingLevels(
  levelPrice: number,
  currentPrice: number,
  significantLevels: number[],
  atr: number,
): number {
  if (atr <= 0) return 0;
  const gap = atr * 0.25;
  const lo = Math.min(levelPrice, currentPrice) + gap;
  const hi = Math.max(levelPrice, currentPrice) - gap;
  return significantLevels.filter((p) => p >= lo && p <= hi).length;
}

// Самый глубокий уход ЗАКРЫТИЕМ за уровень после его образования, в ATR.
// Хвост в `freshBars` баров не смотрим: свежий пробой — это сегодняшняя
// ситуация (в том числе заготовка ЛП2Б), а не свидетельство, что уровень
// давно сняли.
function breachAfterFormed(
  candles: DailyCandle[],
  levelPrice: number,
  atr: number,
  side: LevelSide,
  formedAt: number | undefined,
  freshBars: number,
): number {
  if (formedAt == null || atr <= 0) return 0;
  const until = candles.length - 1 - freshBars;
  let deepest = 0;
  for (let i = 0; i <= until; i++) {
    const bar = candles[i];
    if (bar.t <= formedAt) continue;
    const beyond = side === "above" ? bar.c - levelPrice : levelPrice - bar.c;
    if (beyond > deepest) deepest = beyond;
  }
  return deepest / atr;
}

export function assessLevelQuality(
  candles: DailyCandle[],
  levelPrice: number,
  atr: number,
  currentPrice: number,
  significantLevels: number[],
  th: QualityThresholds = DEFAULT_THRESHOLDS,
  /** БСУ уровня — от него считается breachedAfterFormedAtr. */
  levelFormedAt?: number,
): LevelQuality {
  const side: LevelSide = levelPrice >= currentPrice ? "above" : "below";
  const last = candles[candles.length - 1];
  // История без сегодняшнего бара — иначе текущий подход сам себя засчитает
  // как запил/прокол.
  const history = candles.slice(-th.window, -1);
  const contaminationHistory = candles.slice(-th.contaminationWindow, -1);

  const pierces = findPierces(history, levelPrice, atr, th.minPierceAtr);
  // Серию проколов считаем по окну ВМЕСТЕ с последним закрытым баром: пара
  // «вчера проколол — сегодня снова проколол» целиком лежит в конце окна и в
  // history (без последнего бара) была бы не видна.
  const windowWithLast = candles.slice(-th.window);
  // Прокол последнего закрытого бара: те же правила, что в findPierces, но
  // окно ровно из двух баров — предыдущий нужен лишь чтобы определить, с
  // какой стороны цена подошла.
  const lastBarPierce = candles.length >= 2 ? findPierces(candles.slice(-2), levelPrice, atr, th.minPierceAtr) : { deepestAtr: 0 };
  const approach3 = candles.slice(-3);
  const touchDistance = side === "above" ? levelPrice - last.h : last.l - levelPrice;
  // Тот же разрыв, но у предыдущего бара — разница показывает, продолжал ли
  // вчерашний день идти к уровню или уже отвернул от него.
  const prev = candles.length >= 2 ? candles[candles.length - 2] : null;
  const prevTouchDistance = prev ? (side === "above" ? levelPrice - prev.h : prev.l - levelPrice) : touchDistance;

  return {
    side,
    crossings: countCrossings(history, levelPrice, atr, th.deadbandAtr),
    falseBreakouts: pierces.count,
    deepestFalseBreakoutAtr: pierces.deepestAtr,
    consecutiveFalseBreakouts: maxConsecutivePierces(windowWithLast, levelPrice, atr, th.consecutivePierceAtr, th.deadbandAtr),
    lastBarPierceAtr: lastBarPierce.deepestAtr,
    contamination: contaminationRatio(contaminationHistory, levelPrice, atr, side, th.contaminationZoneAtr),
    runwayAtr: runwayAtr(levelPrice, significantLevels, atr, side),
    closeDistanceAtr: Math.abs(last.c - levelPrice) / atr,
    touched: touchDistance <= atr * th.touchToleranceAtr,
    approachGapAtr: touchDistance / atr,
    approachRatio: mean(approach3.map((c) => c.h - c.l)) / atr,
    gapApproach: hasGapApproach(candles, levelPrice, atr),
    approachNetMoveAtr: netMoveAtr(candles, atr, th.fastApproachWindow),
    turnAwayAtr: (touchDistance - prevTouchDistance) / atr,
    breachedAfterFormedAtr: breachAfterFormed(candles, levelPrice, atr, side, levelFormedAt, th.breachFreshBars),
    blockingLevels: countBlockingLevels(levelPrice, last.c, significantLevels, atr),
  };
}

/** JSON-безопасная форма метрик для колонки LevelSetup.quality. */
export type StoredQuality = Omit<LevelQuality, "runwayAtr"> & { runwayAtr: number | null };

/**
 * Infinity в JSON не существует (JSON.stringify превращает его в null молча),
 * поэтому «за уровнем препятствий нет» кодируем явным null.
 */
export function serializeQuality(q: LevelQuality): StoredQuality {
  return { ...q, runwayAtr: Number.isFinite(q.runwayAtr) ? q.runwayAtr : null };
}

export type RejectReason =
  | "close_far_from_level"
  | "did_not_reach_level"
  | "close_near_level"
  | "level_chopped"
  | "too_many_false_breakouts"
  | "consecutive_false_breakouts"
  | "deep_false_breakout"
  | "unconfirmed_deep_pierce"
  | "contaminated_zone"
  | "no_runway"
  | "no_breakout_preconditions"
  | "no_false_breakout_preconditions"
  | "turned_away_from_level"
  | "level_already_taken"
  | "blocked_path"
  | "no_2b_preconditions";

export interface GateResult {
  ok: boolean;
  rejectedBy: RejectReason[];
}

/**
 * Пропускает только «готовые сегодня» уровни. Проверки общие для обоих
 * сетапов (чистота уровня, запас хода), плюс требования, специфичные для
 * сетапа:
 *
 *  - пробой: закрытие ВПЛОТНУЮ к уровню (maxCloseDistanceAtr) + обязательна
 *    низкая волатильность подхода — малые бары и/или накопление/поджатие
 *    перед уровнем (твх.pdf, обязательные условия);
 *  - ложный пробой: наоборот, вчерашний бар должен был остановиться ДАЛЕКО
 *    от уровня (minFalseBreakoutApproachGapAtr) — весь путь до уровня,
 *    прокол и возврат должен сделать сегодняшний бар — плюс быстрый подход:
 *    большие бары, гэп или длинное безоткатное движение (алгоритм.pdf,
 *    «предпосылки к отбою»). Близкое вчерашнее закрытие для ЛП — не плюс, а
 *    минус: разгона для прокола и возврата за один день уже не остаётся.
 */
export function passesQualityGate(
  q: LevelQuality,
  bias: "breakout" | "false_breakout" | "false_breakout_2b",
  signals: { for: string[]; against: string[] },
  th: QualityThresholds = DEFAULT_THRESHOLDS,
): GateResult {
  const rejectedBy: RejectReason[] = [];

  if (q.crossings > th.maxCrossings) rejectedBy.push("level_chopped");
  if (q.falseBreakouts > th.maxFalseBreakouts) rejectedBy.push("too_many_false_breakouts");
  // Два прокола подряд — уровень распилен: он больше не держит цену, и ни
  // пробой, ни ЛП от него отрабатывать нечего.
  if (q.consecutiveFalseBreakouts > th.maxConsecutiveFalseBreakouts) rejectedBy.push("consecutive_false_breakouts");
  if (q.deepestFalseBreakoutAtr > th.deepFalseBreakoutAtr) rejectedBy.push("deep_false_breakout");
  // Заражённость и запас хода считаются в сторону ПРОБОЙНОЙ плоскости. Для
  // ЛП2Б работа идёт в обратную сторону — обратно от уровня, туда, откуда
  // цена только что пришла, — поэтому обе метрики к нему неприменимы: пустота
  // впереди пробоя не помогает возврату, а «запас хода» у возврата свой (до
  // уровня, откуда начинался разгон).
  if (bias !== "false_breakout_2b") {
    if (q.contamination > th.maxContamination) rejectedBy.push("contaminated_zone");
    if (q.runwayAtr < th.minRunwayAtr) rejectedBy.push("no_runway");
  }

  if (bias === "false_breakout_2b") {
    // Всё специфичное для 2Б (свежесть пробоя, закрытие впритык за уровнем,
    // быстрый подход, дальний ретест) проверяет detectFalseBreakout2b — здесь
    // остаётся только «чистота слева» из общих проверок выше. Дублировать её
    // условия здесь нельзя: LevelQuality считает подход относительно стороны
    // уровня, а у 2Б цена уже по другую его сторону.
    if (!signals.for.includes("false_breakout_2b")) rejectedBy.push("no_2b_preconditions");
  } else if (bias === "breakout") {
    // Фильтр в фильтре: вчерашний прокол глубже unconfirmedPierceAtr. После
    // такого дня уровень ещё ни разу не устоял — ни одного бара, который бы
    // его НЕ пробивал, попросту нет, — а первоначальный импульс уже потрачен
    // на сам прокол. Заходить в пробой на следующий день не от чего.
    // Проверка живёт внутри ветки breakout: для ЛП свежий прокол — это не
    // помеха, а сам сетап.
    if (q.lastBarPierceAtr > th.unconfirmedPierceAtr) rejectedBy.push("unconfirmed_deep_pierce");
    if (q.closeDistanceAtr > th.maxCloseDistanceAtr) rejectedBy.push("close_far_from_level");
    if (!q.touched) rejectedBy.push("did_not_reach_level");
    const calmApproach =
      q.approachRatio <= th.smallBarsRatio ||
      signals.for.includes("accumulation_before_level") ||
      signals.for.includes("small_bars_approach");
    if (!calmApproach || q.gapApproach) rejectedBy.push("no_breakout_preconditions");
  } else {
    if (q.approachGapAtr < th.minFalseBreakoutApproachGapAtr) rejectedBy.push("close_near_level");
    // НЕ approachRatio/big_bars_approach (последние 3 бара) — многодневное
    // пологое "закруглення" к уровню легко даёт пару случайно более крупных
    // баров в конце и ложно проходит эту проверку, хотя реального "довгого
    // безвідкатного руху" там не было (см. approachNetMoveAtr — чистое
    // смещение за весь подход, а не шум последних баров).
    const fastApproach = q.approachNetMoveAtr >= th.minFastApproachNetMoveAtr || q.gapApproach;
    if (!fastApproach) rejectedBy.push("no_false_breakout_preconditions");
    // Подход должен быть ЖИВЫМ: цена, которая вчера отвернула от уровня,
    // сегодня скорее уйдёт в накопление, чем сделает весь путь до уровня с
    // проколом и возвратом. netMove этого не ловит — он смотрит весь путь и
    // остаётся большим по инерции падения/роста, даже когда последние бары
    // уже развернулись (JCTUSDT: слив на 5×ATR, а последние два дня — отскок
    // вверх от дна, до уровня стало дальше на 0.63×ATR).
    if (q.turnAwayAtr > th.maxTurnAwayAtr) rejectedBy.push("turned_away_from_level");
    // Уровень уже сняли: после образования цена закрывалась за ним. Такой
    // откат поглощён следующим движением, и ждать от него разворота нечего —
    // рабочей осталась следующая, ещё не пройденная точка структуры.
    if (q.breachedAfterFormedAtr > th.maxBreachAfterFormedAtr) rejectedBy.push("level_already_taken");
    // Дорога до уровня перегорожена другим уровнем — сегодняшний бар скорее
    // остановится там, чем дойдёт до цели, проколет её и вернётся.
    if (q.blockingLevels > th.maxBlockingLevels) rejectedBy.push("blocked_path");
  }

  return { ok: rejectedBy.length === 0, rejectedBy };
}

/**
 * Ранжирование прошедших отбор: чище история и больше запас хода — тем выше;
 * а вот "подход" считается по-разному для двух сетапов (см. passesQualityGate)
 * — для пробоя чем ближе вчерашнее закрытие к уровню, тем лучше, для ЛП
 * наоборот: чем дальше вчера остановились от уровня, тем чище будет разгон
 * сегодняшнего прокола и возврата. Нужно, чтобы из прошедших гейт оставить в
 * выдаче только несколько лучших инструментов.
 */
export function qualityScore(
  q: LevelQuality,
  strength: number,
  bias: "breakout" | "false_breakout" | "false_breakout_2b" = "breakout",
  returnMoveAtr: number | null = null,
): number {
  const clean = 1 - Math.min(1, q.crossings / (DEFAULT_THRESHOLDS.maxCrossings + 1));
  const strengthNorm = Math.min(1, strength / 6);

  const empty = 1 - Math.min(1, q.contamination / DEFAULT_THRESHOLDS.maxContamination);
  const runway = Math.min(1, (Number.isFinite(q.runwayAtr) ? q.runwayAtr : 5) / 5);

  // У ЛП2Б своя мера «близости»: не подход к уровню, а длина ОБРАТНОГО пути —
  // чем короче возврат, тем выше шанс, что завтрашний бар его пройдёт. Веса
  // при этом общие: со своей шкалой 2Б систематически получал более высокий
  // score и вытеснял пробойные сетапы у тех же инструментов (правило «один
  // инструмент — один сетап» оставляет лучший по score).
  if (bias === "false_breakout_2b") {
    const closeness = returnMoveAtr === null ? 0.5 : 1 - Math.min(1, returnMoveAtr / DEFAULT_2B_MAX_RETURN_ATR);
    return 0.35 * closeness + 0.2 * clean + 0.2 * empty + 0.15 * runway + 0.1 * strengthNorm;
  }

  const closeness =
    bias === "breakout"
      ? 1 - Math.min(1, q.closeDistanceAtr / DEFAULT_THRESHOLDS.maxCloseDistanceAtr)
      : Math.min(1, q.approachGapAtr / (DEFAULT_THRESHOLDS.minFalseBreakoutApproachGapAtr * 2));
  return 0.35 * closeness + 0.2 * clean + 0.2 * empty + 0.15 * runway + 0.1 * strengthNorm;
}
