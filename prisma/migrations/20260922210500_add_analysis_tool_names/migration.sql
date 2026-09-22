-- Persist only allow-listed tool names, never arguments or tool results.
ALTER TABLE "AnalysisRun"
ADD COLUMN "toolNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
