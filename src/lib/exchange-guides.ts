import { prisma } from "./db";

const GUIDES_KEY = "exchange_setup_guides";

/**
 * Default setup guide text for each supported exchange.
 * These ship with the code; admins can override them via /admin/exchange-guides.
 */
export const DEFAULT_EXCHANGE_GUIDES: Record<string, string> = {
  binance:
    "1. Перейдите в [API Management](https://www.binance.com/en/my/settings/api-management).\n" +
    "2. Нажмите «Create API» → выберите «Self-Saved Key».\n" +
    "3. Укажите любое название ключа.\n" +
    "4. Включите **только** разрешение «Enable Reading» (галочка «Can Read»).\n" +
    "   Никакие торговые права **не нужны** — приложение только читает историю сделок.\n" +
    "5. Нажмите «Create» и сохраните **API Key** и **Secret Key**.\n" +
    "6. Если включена IP-привязка — добавьте в белый список IP сервера приложения.",
  bybit:
    "1. Перейдите в [API Management](https://www.bybit.com/app/user/api-management).\n" +
    "2. Нажмите «Create New Key».\n" +
    "3. Выберите тип **«System Generated»** (рекомендуется) или **«Custom»**.\n" +
    "4. В разделе «Permissions» выберите **«Read-Only»**.\n" +
    "5. Убедитесь, что включены «Spot» и «Derivatives» (если торгуете фьючерсами).\n" +
    "6. Нажмите «Confirm» и завершите проверку.\n" +
    "7. Сохраните **API Key**, **Secret** и (если есть) **Passphrase**.",
  okx:
    "1. Перейдите в [My API](https://www.okx.com/account/my-api).\n" +
    "2. Если нет — установите **Passphrase** (фраза-пароль, понадобится при подключении).\n" +
    "3. Нажмите «Create New API Key».\n" +
    "4. Выберите **«Self-signed»** (рекомендуется).\n" +
    "5. В разделе «Permissions» оставьте **только «Read»** — права на торговлю не нужны.\n" +
    "6. Нажмите «Confirm» и пройдите 2FA.\n" +
    "7. Сохраните **API Key**, **Secret Key** и **Passphrase** — все три понадобятся.",
  kraken:
    "1. Перейдите в [API Settings](https://www.kraken.com/u/security/api).\n" +
    "2. Нажмите «Add Key».\n" +
    "3. Укажите название ключа.\n" +
    "4. В разделе «Permissions» выберите **«Query only»**.\n" +
    "5. Убедитесь, что внизу включены права:\n" +
    "   - «Query Funds» (баланс)\n" +
    "   - «Query Closed Orders / Trades History» (история сделок)\n" +
    "6. Нажмите «Generate Key».\n" +
    "7. Сохраните **API Key** и **Private Key**.",
  kucoin:
    "1. Перейдите в [API Management](https://www.kucoin.com/account/api).\n" +
    "2. Нажмите «Create API».\n" +
    "3. Выберите тип **«General API»**.\n" +
    "4. В разделе «Permissions» выберите **«Read Only»**.\n" +
    "5. Установите **Passphrase** — она потребуется при подключении аккаунта.\n" +
    "6. Нажмите «Confirm» и пройдите 2FA.\n" +
    "7. Сохраните **API Key**, **Secret** и **Passphrase**.",
  bitget:
    "1. Перейдите в [API Management](https://www.bitget.com/account/newapi).\n" +
    "2. Нажмите «Create API Key».\n" +
    "3. Выберите тип **«Read-only»**.\n" +
    "4. Задайте **Passphrase** — она потребуется при подключении.\n" +
    "5. Нажмите «Next» и пройдите проверку.\n" +
    "6. Сохраните **API Key**, **Secret Key** и **Passphrase**.",
  gate:
    "1. Перейдите в [API Keys](https://www.gate.io/myaccount/apiv4keys).\n" +
    "2. Нажмите «Create API Key».\n" +
    "3. Выберите тип **«APIv4»**.\n" +
    "4. В разделе «Permissions» отключите **все** права, кроме «Spot Trade — Read».\n" +
    "   (в некоторых версиях интерфейса — просто «Read-Only»)\n" +
    "5. Нажмите «Confirm» и пройдите 2FA.\n" +
    "6. Сохраните **API Key** и **Secret**.",
  mexc:
    "1. Перейдите в [API Management](https://www.mexc.com/user/openapi).\n" +
    "2. Нажмите «Create API Key».\n" +
    "3. Выберите тип **«Read-only API»**.\n" +
    "4. Убедитесь, что включено **«Read: Spot Trading»** (разрешение на чтение истории спот-сделок).\n" +
    "   Без этого права синхронизация будет падать с ошибкой «No permission to access the endpoint».\n" +
    "5. Нажмите «Confirm» и пройдите 2FA.\n" +
    "6. Сохраните **API Key** и **Secret**.",
  htx:
    "1. Перейдите в [API Key Management](https://www.htx.com/en-us/apikey/).\n" +
    "2. Нажмите «Create API Key».\n" +
    "3. Выберите тип **«Read-Only API»**.\n" +
    "4. Убедитесь, что права на торговлю **отключены**.\n" +
    "5. Нажмите «Confirm» и пройдите 2FA.\n" +
    "6. Сохраните **API Key** и **Secret**.",
};

/**
 * Merge DB-stored overrides with code defaults and return the full guide map.
 */
export async function getExchangeGuides(): Promise<Record<string, string>> {
  let guides = { ...DEFAULT_EXCHANGE_GUIDES };
  const row = await prisma.featureConfig.findUnique({
    where: { key: GUIDES_KEY },
  });
  if (row?.config) {
    try {
      const stored = JSON.parse(row.config);
      guides = { ...guides, ...stored };
    } catch {
      // corrupt JSON, use defaults
    }
  }
  return guides;
}

/**
 * Persist a guide override for one exchange.
 */
export async function saveExchangeGuide(
  exchangeId: string,
  guide: string,
): Promise<void> {
  const current = await getExchangeGuides();
  const stored = { ...DEFAULT_EXCHANGE_GUIDES, ...current, [exchangeId]: guide };
  await prisma.featureConfig.upsert({
    where: { key: GUIDES_KEY },
    create: {
      key: GUIDES_KEY,
      enabled: true,
      config: JSON.stringify(stored),
    },
    update: {
      config: JSON.stringify(stored),
    },
  });
}