-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PricePurpose" AS ENUM ('EVENT', 'MARK');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "refreshTokenExpiresAt" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preference" (
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "denomination" TEXT NOT NULL DEFAULT 'USD',

    CONSTRAINT "Preference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" UUID NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "market" JSONB NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "notes" TEXT,
    "walletAddress" TEXT,
    "positionRef" TEXT,
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEvent" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "txHash" TEXT,
    "actionIndex" INTEGER,
    "hasNetworkFee" BOOLEAN NOT NULL,

    CONSTRAINT "JournalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRevision" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "facts" JSONB NOT NULL,
    "format" INTEGER NOT NULL DEFAULT 1,
    "priceSetId" UUID NOT NULL,
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSet" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "purpose" "PricePurpose" NOT NULL,
    "quotes" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalDraft" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "fields" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JournalDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalEvaluation" (
    "strategyId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "version" TEXT NOT NULL,
    "priceSetId" UUID NOT NULL,
    "revisionIds" JSONB NOT NULL,
    "results" JSONB NOT NULL,

    CONSTRAINT "FinalEvaluation_pkey" PRIMARY KEY ("strategyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE INDEX "Strategy_ownerId_closedAt_openedAt_idx" ON "Strategy"("ownerId", "closedAt", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_id_ownerId_chainId_key" ON "Strategy"("id", "ownerId", "chainId");

-- CreateIndex
CREATE INDEX "JournalEvent_strategyId_occurredAt_sequence_idx" ON "JournalEvent"("strategyId", "occurredAt", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEvent_strategyId_id_key" ON "JournalEvent"("strategyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEvent_strategyId_sequence_key" ON "JournalEvent"("strategyId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEvent_ownerId_chainId_txHash_actionIndex_key" ON "JournalEvent"("ownerId", "chainId", "txHash", "actionIndex");

-- CreateIndex
CREATE UNIQUE INDEX "EventRevision_eventId_version_key" ON "EventRevision"("eventId", "version");

-- CreateIndex
CREATE INDEX "PriceSet_strategyId_purpose_at_createdAt_idx" ON "PriceSet"("strategyId", "purpose", "at" DESC, "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PriceSet_strategyId_id_key" ON "PriceSet"("strategyId", "id");

-- CreateIndex
CREATE INDEX "JournalDraft_strategyId_updatedAt_idx" ON "JournalDraft"("strategyId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinalEvaluation_strategyId_priceSetId_key" ON "FinalEvaluation"("strategyId", "priceSetId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preference" ADD CONSTRAINT "Preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEvent" ADD CONSTRAINT "JournalEvent_strategyId_ownerId_chainId_fkey" FOREIGN KEY ("strategyId", "ownerId", "chainId") REFERENCES "Strategy"("id", "ownerId", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRevision" ADD CONSTRAINT "EventRevision_strategyId_eventId_fkey" FOREIGN KEY ("strategyId", "eventId") REFERENCES "JournalEvent"("strategyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRevision" ADD CONSTRAINT "EventRevision_strategyId_priceSetId_fkey" FOREIGN KEY ("strategyId", "priceSetId") REFERENCES "PriceSet"("strategyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRevision" ADD CONSTRAINT "EventRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSet" ADD CONSTRAINT "PriceSet_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalDraft" ADD CONSTRAINT "JournalDraft_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalEvaluation" ADD CONSTRAINT "FinalEvaluation_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalEvaluation" ADD CONSTRAINT "FinalEvaluation_strategyId_priceSetId_fkey" FOREIGN KEY ("strategyId", "priceSetId") REFERENCES "PriceSet"("strategyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce cross-cycle deduplication without conflating separate actions in one transaction.
CREATE UNIQUE INDEX "journal_one_network_fee"
  ON "JournalEvent" ("ownerId", "chainId", "txHash") WHERE "hasNetworkFee";
CREATE UNIQUE INDEX "journal_one_opening"
  ON "JournalEvent" ("strategyId") WHERE "kind" = 'OPENING_ALLOCATION';
CREATE UNIQUE INDEX "strategy_unique_open_position"
  ON "Strategy" ("ownerId", "chainId", lower("protocol"), lower("positionRef"))
  WHERE "closedAt" IS NULL AND "positionRef" IS NOT NULL;

ALTER TABLE "JournalEvent" ADD CONSTRAINT "journal_valid_index" CHECK (
  "sequence" > 0 AND
  (("txHash" IS NULL AND "actionIndex" IS NULL AND NOT "hasNetworkFee") OR
   ("txHash" IS NOT NULL AND "txHash" ~ '^0x[a-f0-9]{64}$' AND "actionIndex" IS NOT NULL AND "actionIndex" >= 0))
);
ALTER TABLE "EventRevision" ADD CONSTRAINT "journal_revision_audit" CHECK (
  ("version" = 1 AND "reason" IS NULL) OR ("version" > 1 AND length(trim("reason")) >= 3 AND "reason" IS NOT NULL)
);
