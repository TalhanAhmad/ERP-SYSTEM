-- CreateTable
CREATE TABLE "ReportRevision" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportRevision_reportId_version_key" ON "ReportRevision"("reportId", "version");
