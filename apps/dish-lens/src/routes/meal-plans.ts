import { requireAuth, type AuthenticatedRequest } from "@lens-and-sync/shared-auth";
import type { ErrorRequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { addMealEntry, createMealPlan, deleteMealPlan, getMealPlan, listMealPlans, removeMealEntry } from "../meal-planning/index.js";

const planIdSchema = z.string().uuid();
const entryIdSchema = z.string().uuid();

const createPlanSchema = z.object({
  name: z.string().min(1).max(100),
});

const addEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK"]),
  dishName: z.string().min(1).max(200),
  notes: z.string().max(500).optional(),
});

export const mealPlansRouter: Router = Router();

mealPlansRouter.use(requireAuth(config.JWT_ACCESS_SECRET, logger));

mealPlansRouter.post("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A non-empty 'name' (max 100 chars) is required." } });
      return;
    }
    const plan = await createMealPlan(req.userId as string, parsed.data.name);
    res.status(201).json({ plan });
  } catch (err) {
    next(err);
  }
});

mealPlansRouter.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const plans = await listMealPlans(req.userId as string);
    res.status(200).json({ plans });
  } catch (err) {
    next(err);
  }
});

mealPlansRouter.get("/:planId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsedId = planIdSchema.safeParse(req.params.planId);
    if (!parsedId.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A valid plan ID is required." } });
      return;
    }
    const plan = await getMealPlan(req.userId as string, parsedId.data);
    if (!plan) {
      res.status(404).json({ error: { code: "not-found", message: "Meal plan not found." } });
      return;
    }
    res.status(200).json({ plan });
  } catch (err) {
    next(err);
  }
});

mealPlansRouter.delete("/:planId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsedId = planIdSchema.safeParse(req.params.planId);
    if (!parsedId.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A valid plan ID is required." } });
      return;
    }
    const deleted = await deleteMealPlan(req.userId as string, parsedId.data);
    if (!deleted) {
      res.status(404).json({ error: { code: "not-found", message: "Meal plan not found." } });
      return;
    }
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

mealPlansRouter.post("/:planId/entries", async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsedId = planIdSchema.safeParse(req.params.planId);
    if (!parsedId.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A valid plan ID is required." } });
      return;
    }
    const parsed = addEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "Required: date (YYYY-MM-DD), mealType (BREAKFAST|LUNCH|DINNER|SNACK), dishName." } });
      return;
    }
    const entry = await addMealEntry(req.userId as string, parsedId.data, parsed.data);
    if (!entry) {
      res.status(404).json({ error: { code: "not-found", message: "Meal plan not found." } });
      return;
    }
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
});

mealPlansRouter.delete("/:planId/entries/:entryId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsedPlanId = planIdSchema.safeParse(req.params.planId);
    const parsedEntryId = entryIdSchema.safeParse(req.params.entryId);
    if (!parsedPlanId.success || !parsedEntryId.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "Valid plan and entry IDs are required." } });
      return;
    }
    const removed = await removeMealEntry(req.userId as string, parsedPlanId.data, parsedEntryId.data);
    if (!removed) {
      res.status(404).json({ error: { code: "not-found", message: "Meal entry not found." } });
      return;
    }
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

const handleMealPlanError: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  logger.error({ err }, "Unhandled error in /meal-plans");
  res.status(500).json({ error: { code: "internal-error", message: "An unexpected error occurred." } });
};

mealPlansRouter.use(handleMealPlanError);
