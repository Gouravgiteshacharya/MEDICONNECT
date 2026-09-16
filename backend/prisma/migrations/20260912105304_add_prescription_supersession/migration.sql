/*
  Warnings:

  - A unique constraint covering the columns `[supersedesPrescriptionId]` on the table `Prescription` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "supersedesPrescriptionId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_supersedesPrescriptionId_key" ON "Prescription"("supersedesPrescriptionId");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_supersedesPrescriptionId_fkey" FOREIGN KEY ("supersedesPrescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
