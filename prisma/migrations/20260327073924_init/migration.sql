-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('PENDING', 'OPEN', 'LOCKED', 'RESOLVED', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MarketOutcome" AS ENUM ('YES', 'NO', 'VOID');

-- CreateEnum
CREATE TYPE "ResolutionSource" AS ENUM ('CHAINLINK_PRICE', 'CHAINLINK_EVENT', 'AI_WEB_SEARCH', 'MANUAL');

-- CreateEnum
CREATE TYPE "StakeSide" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "conditionOperator" TEXT NOT NULL,
    "conditionThreshold" TEXT NOT NULL,
    "conditionUnit" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "resolutionSource" "ResolutionSource" NOT NULL,
    "resolutionKey" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "parserNotes" TEXT,
    "status" "MarketStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" "MarketOutcome",
    "contractAddress" TEXT,
    "deploymentTxHash" TEXT,
    "yesPool" TEXT NOT NULL DEFAULT '0',
    "noPool" TEXT NOT NULL DEFAULT '0',
    "creatorAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stake" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "side" "StakeSide" NOT NULL,
    "amount" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResolutionEvidence" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcome" "MarketOutcome" NOT NULL,
    "oracleValue" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "settlementTxHash" TEXT,
    "settlementBlock" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResolutionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketJob" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "bullJobId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnChainEvent" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "eventName" TEXT NOT NULL,
    "marketId" TEXT,
    "rawData" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Market_contractAddress_key" ON "Market"("contractAddress");

-- CreateIndex
CREATE INDEX "Market_status_idx" ON "Market"("status");

-- CreateIndex
CREATE INDEX "Market_creatorAddress_idx" ON "Market"("creatorAddress");

-- CreateIndex
CREATE INDEX "Market_deadline_idx" ON "Market"("deadline");

-- CreateIndex
CREATE INDEX "Market_resolutionSource_idx" ON "Market"("resolutionSource");

-- CreateIndex
CREATE UNIQUE INDEX "Stake_txHash_key" ON "Stake"("txHash");

-- CreateIndex
CREATE INDEX "Stake_marketId_idx" ON "Stake"("marketId");

-- CreateIndex
CREATE INDEX "Stake_userAddress_idx" ON "Stake"("userAddress");

-- CreateIndex
CREATE INDEX "Stake_txHash_idx" ON "Stake"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "ResolutionEvidence_marketId_key" ON "ResolutionEvidence"("marketId");

-- CreateIndex
CREATE INDEX "MarketJob_marketId_idx" ON "MarketJob"("marketId");

-- CreateIndex
CREATE INDEX "MarketJob_status_idx" ON "MarketJob"("status");

-- CreateIndex
CREATE INDEX "MarketJob_jobType_idx" ON "MarketJob"("jobType");

-- CreateIndex
CREATE UNIQUE INDEX "OnChainEvent_txHash_key" ON "OnChainEvent"("txHash");

-- CreateIndex
CREATE INDEX "OnChainEvent_eventName_idx" ON "OnChainEvent"("eventName");

-- CreateIndex
CREATE INDEX "OnChainEvent_marketId_idx" ON "OnChainEvent"("marketId");

-- AddForeignKey
ALTER TABLE "Stake" ADD CONSTRAINT "Stake_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionEvidence" ADD CONSTRAINT "ResolutionEvidence_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketJob" ADD CONSTRAINT "MarketJob_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
