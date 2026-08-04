import { prisma } from "@lens-and-sync/shared-db";

export interface ScanNutrition {
  calories: number;
  proteinGrams: number;
  fatGrams: number;
  carbsGrams: number;
}

export interface CreateScanInput {
  dishName: string;
  ingredients: string[];
  steps: string[];
  nutrition: ScanNutrition | null;
  imageObjectKey: string | null;
}

export interface ScanSummary {
  id: string;
  dishName: string;
  ingredients: string[];
  steps: string[];
  nutrition: ScanNutrition | null;
  imageObjectKey: string | null;
  createdAt: Date;
}

interface ScanRecord {
  id: string;
  dishName: string;
  ingredients: string[];
  steps: string[];
  calories: number | null;
  proteinGrams: number | null;
  fatGrams: number | null;
  carbsGrams: number | null;
  imageObjectKey: string | null;
  createdAt: Date;
}

function toSummary(record: ScanRecord): ScanSummary {
  return {
    id: record.id,
    dishName: record.dishName,
    ingredients: record.ingredients,
    steps: record.steps,
    nutrition:
      record.calories === null
        ? null
        : {
            calories: record.calories,
            proteinGrams: record.proteinGrams ?? 0,
            fatGrams: record.fatGrams ?? 0,
            carbsGrams: record.carbsGrams ?? 0,
          },
    imageObjectKey: record.imageObjectKey,
    createdAt: record.createdAt,
  };
}

/** Snapshots an already-fetched /upload result — never re-runs Vision/Claude/Edamam. */
export async function createScan(userId: string, input: CreateScanInput): Promise<ScanSummary> {
  const record = await prisma.scan.create({
    data: {
      userId,
      dishName: input.dishName,
      ingredients: input.ingredients,
      steps: input.steps,
      calories: input.nutrition?.calories ?? null,
      proteinGrams: input.nutrition?.proteinGrams ?? null,
      fatGrams: input.nutrition?.fatGrams ?? null,
      carbsGrams: input.nutrition?.carbsGrams ?? null,
      imageObjectKey: input.imageObjectKey,
    },
  });
  return toSummary(record);
}

export async function listScans(userId: string): Promise<ScanSummary[]> {
  const records = await prisma.scan.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return records.map(toSummary);
}

/** Owner-scoped — used by meal-planning to copy dishName/ingredients onto a MealEntry. */
export async function getScan(userId: string, scanId: string): Promise<ScanSummary | null> {
  const record = await prisma.scan.findFirst({ where: { id: scanId, userId } });
  return record ? toSummary(record) : null;
}
