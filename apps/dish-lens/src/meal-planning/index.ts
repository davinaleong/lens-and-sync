import { type MealEntry, type MealPlan, type MealType, prisma } from "@lens-and-sync/shared-db";
import { getScan } from "../scans/index.js";

export type { MealType };

export interface MealPlanSummary {
  id: string;
  name: string;
  entryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MealEntryInput {
  date: string;
  mealType: MealType;
  scanId: string;
  notes?: string;
}

export type AddMealEntryResult =
  | { ok: true; entry: MealEntry }
  | { ok: false; reason: "plan-not-found" | "scan-not-found" };

export interface FullMealPlan {
  id: string;
  name: string;
  entries: Array<{
    id: string;
    date: string;
    mealType: MealType;
    dishName: string;
    ingredients: string[];
    notes: string | null;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export async function createMealPlan(userId: string, name: string): Promise<MealPlan> {
  return prisma.mealPlan.create({ data: { userId, name } });
}

export async function listMealPlans(userId: string): Promise<MealPlanSummary[]> {
  const plans = await prisma.mealPlan.findMany({
    where: { userId },
    select: { id: true, name: true, createdAt: true, updatedAt: true, _count: { select: { entries: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return plans.map((p) => ({ id: p.id, name: p.name, entryCount: p._count.entries, createdAt: p.createdAt, updatedAt: p.updatedAt }));
}

export async function getMealPlan(userId: string, planId: string): Promise<FullMealPlan | null> {
  const plan = await prisma.mealPlan.findFirst({
    where: { id: planId, userId },
    include: { entries: { orderBy: [{ date: "asc" }, { mealType: "asc" }] } },
  });
  if (!plan) return null;
  return {
    id: plan.id,
    name: plan.name,
    entries: plan.entries.map((e) => ({
      id: e.id,
      date: e.date.toISOString().slice(0, 10),
      mealType: e.mealType,
      dishName: e.dishName,
      ingredients: e.ingredients,
      notes: e.notes,
      createdAt: e.createdAt,
    })),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export async function deleteMealPlan(userId: string, planId: string): Promise<boolean> {
  const result = await prisma.mealPlan.deleteMany({ where: { id: planId, userId } });
  return result.count > 0;
}

export async function addMealEntry(userId: string, planId: string, data: MealEntryInput): Promise<AddMealEntryResult> {
  // Verify ownership before writing to prevent cross-user writes.
  const plan = await prisma.mealPlan.findFirst({ where: { id: planId, userId }, select: { id: true } });
  if (!plan) return { ok: false, reason: "plan-not-found" };

  // dishName/ingredients are never client-supplied - always copied
  // server-side from an owned Scan, so a plan entry can't claim ingredients
  // that were never actually produced by a real upload.
  const scan = await getScan(userId, data.scanId);
  if (!scan) return { ok: false, reason: "scan-not-found" };

  const entry = await prisma.mealEntry.create({
    data: {
      mealPlanId: planId,
      date: new Date(data.date),
      mealType: data.mealType,
      dishName: scan.dishName,
      ingredients: scan.ingredients,
      notes: data.notes,
    },
  });
  return { ok: true, entry };
}

export async function removeMealEntry(userId: string, planId: string, entryId: string): Promise<boolean> {
  const entry = await prisma.mealEntry.findFirst({
    where: { id: entryId, mealPlanId: planId, mealPlan: { userId } },
    select: { id: true },
  });
  if (!entry) return false;
  await prisma.mealEntry.delete({ where: { id: entryId } });
  return true;
}
