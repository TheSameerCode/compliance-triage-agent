-- CreateEnum
CREATE TYPE "AnalysisCategory" AS ENUM ('safeguarding', 'harassment', 'discrimination', 'financial', 'privacy', 'other');

-- CreateEnum
CREATE TYPE "AnalysisSeverity" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('completed', 'fallback');

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "model" VARCHAR(200) NOT NULL,
    "promptVersion" VARCHAR(100) NOT NULL,
    "category" "AnalysisCategory",
    "severity" "AnalysisSeverity",
    "summary" TEXT,
    "confidence" DOUBLE PRECISION,
    "missingInformation" JSONB NOT NULL,
    "indicators" JSONB NOT NULL,
    "modelSuggestsHumanReview" BOOLEAN,
    "reviewRequired" BOOLEAN NOT NULL,
    "reviewReasons" JSONB NOT NULL,
    "analysisStatus" "AnalysisStatus" NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCost" DECIMAL(12,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalysisRun_caseId_createdAt_idx" ON "AnalysisRun"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_reviewRequired_createdAt_idx" ON "AnalysisRun"("reviewRequired", "createdAt");

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
