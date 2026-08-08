-- Последний снапшот стакана — одна строка на (symbol, exchange).
--
-- Профиль текущего стакана искал MAX(t) коррелированным подзапросом по сырому
-- ObSnapshot и делал это на каждый опрос orderflow (раз в 3 с на клиента),
-- дважды сканируя окно. Теперь читается по первичному ключу.

CREATE TABLE IF NOT EXISTS "ObLatestBook" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "t" TIMESTAMPTZ(3) NOT NULL,
    "mid" DOUBLE PRECISION NOT NULL,
    "levels" JSONB NOT NULL,

    CONSTRAINT "ObLatestBook_pkey" PRIMARY KEY ("symbol","exchange")
);
