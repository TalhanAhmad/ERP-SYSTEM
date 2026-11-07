-- CreateTable
CREATE TABLE "SchedulePolicy" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "localStart" TEXT NOT NULL,
    "localEnd" TEXT NOT NULL,
    "weekdays" JSONB NOT NULL,
    "graceMinutes" INTEGER NOT NULL,
    "closingBufferMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleAssignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDay" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "firstIn" TIMESTAMPTZ,
    "lastOut" TIMESTAMPTZ,
    "grossMinutes" INTEGER,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "early" BOOLEAN NOT NULL DEFAULT false,
    "corrected" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceEvent" (
    "id" UUID NOT NULL,
    "dayId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceCorrection" (
    "id" UUID NOT NULL,
    "dayId" UUID NOT NULL,
    "requestedBy" UUID NOT NULL,
    "proposedIn" TIMESTAMPTZ NOT NULL,
    "proposedOut" TIMESTAMPTZ NOT NULL,
    "reason" TEXT NOT NULL,
    "expectedDayVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerId" UUID,
    "reviewedAt" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "privateNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerId" UUID,
    "reviewedAt" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveDate" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LeaveDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "completedText" TEXT NOT NULL,
    "remainingText" TEXT NOT NULL,
    "blockersText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMPTZ,
    "acknowledgedBy" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleAssignment_userId_startDate_idx" ON "ScheduleAssignment"("userId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_userId_workDate_key" ON "AttendanceDay"("userId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEvent_dayId_kind_key" ON "AttendanceEvent"("dayId", "kind");

-- CreateIndex
CREATE INDEX "LeaveDate_userId_workDate_idx" ON "LeaveDate"("userId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_userId_workDate_key" ON "DailyReport"("userId", "workDate");

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "AttendanceDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveDate" ADD CONSTRAINT "LeaveDate_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LeaveRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
