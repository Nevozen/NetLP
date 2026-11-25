ALTER TABLE "JournalEvent" ADD COLUMN "walletOrigin" JSONB;
ALTER TABLE "WalletActivity" ADD COLUMN "postedStrategyId" UUID,
    ADD COLUMN "postedEventIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

CREATE TABLE "WalletImportReview" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "strategyId" UUID NOT NULL,
    "data" JSONB,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "postedAt" TIMESTAMPTZ(3),
    CONSTRAINT "WalletImportReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WalletImportReview_strategyId_ownerId_chainId_fkey"
        FOREIGN KEY ("strategyId", "ownerId", "chainId") REFERENCES "Strategy"("id", "ownerId", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "WalletImportReview_ownerId_expiresAt_idx" ON "WalletImportReview"("ownerId", "expiresAt");
