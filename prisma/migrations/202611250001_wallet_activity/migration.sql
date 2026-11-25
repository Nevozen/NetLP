CREATE TYPE "WalletSource" AS ENUM ('ALCHEMY', 'CSV', 'HASH');
CREATE TYPE "WalletStatus" AS ENUM ('DETECTED', 'CONFIRMING', 'READY', 'NEEDS_REVIEW', 'ACTIVITY_ONLY', 'POSTED', 'UNRELATED');

CREATE TABLE "WalletWatch" (
    "ownerId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recent" BOOLEAN NOT NULL,
    "startBlock" BIGINT,
    "nextBlock" BIGINT,
    "cursor" JSONB,
    "lease" UUID,
    "leaseUntil" TIMESTAMPTZ(3),
    "nextSyncAt" TIMESTAMPTZ(3),
    "lastSyncedAt" TIMESTAMPTZ(3),
    "issue" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "WalletWatch_pkey" PRIMARY KEY ("ownerId", "chainId"),
    CONSTRAINT "WalletWatch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WalletWatch_base_address" CHECK ("chainId" = '8453' AND "address" ~ '^0x[0-9a-f]{40}$')
);

CREATE TABLE "WalletActivity" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "sources" "WalletSource"[],
    "status" "WalletStatus" NOT NULL DEFAULT 'DETECTED',
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "blockNumber" BIGINT,
    "blockHash" TEXT,
    "txIndex" INTEGER,
    "occurredAt" TIMESTAMPTZ(3),
    "topLevel" BOOLEAN NOT NULL DEFAULT false,
    "hasTokens" BOOLEAN NOT NULL DEFAULT false,
    "hasNfts" BOOLEAN NOT NULL DEFAULT false,
    "evidence" JSONB,
    "draft" JSONB,
    "retryAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletActivity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WalletActivity_ownerId_chainId_fkey" FOREIGN KEY ("ownerId", "chainId") REFERENCES "WalletWatch"("ownerId", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WalletActivity_source_identity" CHECK ("address" ~ '^0x[0-9a-f]{40}$' AND "txHash" ~ '^0x[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "WalletActivity_ownerId_chainId_address_txHash_key" ON "WalletActivity"("ownerId", "chainId", "address", "txHash");
CREATE INDEX "WalletActivity_ownerId_chainId_address_status_retryAt_idx" ON "WalletActivity"("ownerId", "chainId", "address", "status", "retryAt");
CREATE INDEX "WalletActivity_ownerId_chainId_address_occurredAt_id_idx" ON "WalletActivity"("ownerId", "chainId", "address", "occurredAt" DESC, "id");
