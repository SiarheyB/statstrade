-- Add ImportLog model

CreateTable "import_logs" (
    "id" SERIAL NOT NULL,
    "module" VARCHAR(32) NOT NULL,
    "account_id" VARCHAR(64),
    "event_type" VARCHAR(32) NOT NULL,
    "message" TEXT,
    "details" JSONB,
    "level" VARCHAR(10) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "idx_import_logs_timestamp" ON "import_logs" ("timestamp");
CREATE INDEX "idx_import_logs_module" ON "import_logs" ("module");
CREATE INDEX "idx_import_logs_account_id" ON "import_logs" ("account_id");
CREATE INDEX "idx_import_logs_event_type" ON "import_logs" ("event_type");

-- Add foreign key if needed (no foreign key now)

