-- AlterTable
ALTER TABLE "MealEntry" ADD COLUMN     "ingredients" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dishName" TEXT NOT NULL,
    "ingredients" TEXT[],
    "steps" TEXT[],
    "calories" DOUBLE PRECISION,
    "proteinGrams" DOUBLE PRECISION,
    "fatGrams" DOUBLE PRECISION,
    "carbsGrams" DOUBLE PRECISION,
    "imageObjectKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scan_userId_idx" ON "Scan"("userId");

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
