-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('NEW', 'ANALYZED', 'REVIEW_REQUIRED');

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reporterType" VARCHAR(100),
    "subjectRef" VARCHAR(128),
    "status" "CaseStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Case_status_createdAt_idx" ON "Case"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Case_subjectRef_idx" ON "Case"("subjectRef");
