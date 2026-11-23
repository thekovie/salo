import { z } from "zod";
import { normalizeText } from "@/lib/dish-name";
import { ADJUSTMENT_CATEGORIES, ADJUSTMENT_METHODS } from "@/lib/snapshot";
import { MAX_SERVICE_CHARGE_CENTAVOS, MAX_UNIT_PRICE_CENTAVOS } from "@/lib/money";

export const LIMITS = {
  dishName: 60,
  variant: 40,
  instructions: 140,
  label: 40,
  title: 60,
  quantity: 99,
  entriesPerSession: 300,
  /** Lifetime cap including removed entries, so add/remove loops cannot grow a session forever. */
  entriesEverPerSession: 1000,
  dishesPerSession: 300,
  groupsPerSession: 30,
  roundsPerSession: 30,
  correctionsPerSession: 100,
  participantsPerSession: 30,
  adjustmentsPerSession: 20,
  /** The host's optional note to a guest they remove. */
  removalReason: 140,
} as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    // PostgreSQL text cannot hold NUL; refuse it as input instead of failing with a server error.
    .refine((value) => !value.includes("\u0000"), "That text contains an invalid character.");
const optional = (max: number) => text(max).nullish();

export const attributionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("UNASSIGNED") }),
  z.object({ type: z.literal("TABLE") }),
  /** A person: a joined participant, or just a name the host typed (guests need not join). */
  z.object({ type: z.literal("INDIVIDUAL"), participantId: z.uuid().nullish(), label: optional(LIMITS.label) }),
  z.object({ type: z.literal("GROUP"), label: text(LIMITS.label).min(1, "Give the group a name.") }),
]);

export const addEntrySchema = z.object({
  dishName: text(LIMITS.dishName).min(1, "Type a dish name."),
  quantity: z.number().int().min(1).max(LIMITS.quantity),
  variant: optional(LIMITS.variant),
  instructions: optional(LIMITS.instructions),
  attribution: attributionSchema.default({ type: "UNASSIGNED" }),
  /** The round the client was adding to (optional for older clients and the host's manual entry). */
  roundId: z.uuid().optional(),
  /** Optional price each in centavos (KKB). */
  unitPriceCentavos: z.number().int().min(0).max(MAX_UNIT_PRICE_CENTAVOS).nullish(),
});

export const updateEntrySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    quantity: z.number().int().min(1).max(LIMITS.quantity).optional(),
    variant: optional(LIMITS.variant),
    instructions: optional(LIMITS.instructions),
    /** Who the dish is for (brief 4.1 "manage entry attribution", 5.12 "correct draft entries"). */
    attribution: attributionSchema.optional(),
  })
  .refine((v) => v.quantity !== undefined || v.variant !== undefined || v.instructions !== undefined || v.attribution !== undefined, "Nothing to change.");

export const renameSessionSchema = z.object({ title: optional(LIMITS.title) });

export type AddEntryInput = z.infer<typeof addEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type AttributionInput = z.infer<typeof attributionSchema>;

export const readySchema = z.object({ ready: z.boolean() });
export const groupMembersSchema = z.object({ label: text(LIMITS.label).min(1, "Give the group a name."), memberIds: z.array(z.uuid()).max(LIMITS.participantsPerSession) });
export const claimSchema = z.object({ batchId: z.uuid() });

export const confirmSchema = z.object({ expectedRevision: z.number().int().min(0) });
export const correctionSchema = z.object({
  sourceEntryId: z.uuid(),
  type: z.enum(["QUANTITY", "REPLACE"]),
  quantity: z.number().int().min(1).max(LIMITS.quantity).optional(),
  replacement: optional(LIMITS.dishName),
  explanation: optional(LIMITS.instructions),
});
export type CorrectionInput = z.infer<typeof correctionSchema>;

/** One change across several source entries (one per person of a preparation); all-or-nothing. */
export const correctionBatchSchema = z.object({
  entries: z
    .array(z.object({ sourceEntryId: z.uuid(), quantity: z.number().int().min(1).max(LIMITS.quantity).optional() }))
    .min(1)
    .max(LIMITS.correctionsPerSession)
    .refine((list) => new Set(list.map((e) => e.sourceEntryId)).size === list.length, "Each dish can be listed once."),
  type: z.enum(["QUANTITY", "REPLACE"]),
  replacement: optional(LIMITS.dishName),
  explanation: optional(LIMITS.instructions),
});
export type CorrectionBatchInput = z.infer<typeof correctionBatchSchema>;

export const unavailableSchema = z.object({ replacement: optional(LIMITS.dishName), note: optional(LIMITS.instructions) });
export type UnavailableInput = z.infer<typeof unavailableSchema>;

export const removeParticipantSchema = z.object({ reason: z.string().trim().max(LIMITS.removalReason, `Keep the reason under ${LIMITS.removalReason} characters.`).nullish() });

/** Whole centavos; null clears (unknown price / service charge not entered). */
const centavos = (max: number) => z.number().int("Use whole centavos.").min(0, "Can't be negative.").max(max, "That amount is too large.").nullable();

export const entrySettlementSchema = z
  .object({
    /** The settlement row's revision the person saw; 0 when nothing was set yet. */
    expectedRevision: z.number().int().min(0),
    unitPriceCentavos: centavos(MAX_UNIT_PRICE_CENTAVOS).optional(),
    /** Host only, shared or unassigned dishes only: who pays for the whole dish. null clears. */
    billTo: z.union([z.object({ participantId: z.uuid() }), z.object({ label: text(LIMITS.label).min(1, "Type the person's name.") }), z.null()]).optional(),
  })
  .refine((v) => v.unitPriceCentavos !== undefined || v.billTo !== undefined, "Nothing to change.");
export type EntrySettlementInput = z.infer<typeof entrySettlementSchema>;

export const correctionPriceSchema = z.object({ expectedRevision: z.number().int().min(0), unitPriceCentavos: centavos(MAX_UNIT_PRICE_CENTAVOS) });
export type CorrectionPriceInput = z.infer<typeof correctionPriceSchema>;

export const sharedPriceSchema = z
  .object({
    dishId: z.uuid(),
    /** Size as typed; null or blank = no size. */
    variant: text(LIMITS.variant).nullable(),
    /** null removes the table price. */
    unitCentavos: centavos(MAX_UNIT_PRICE_CENTAVOS),
    expectedRevision: z.number().int().min(0),
    /** "Every … here": this line's own price is cleared in the same change. */
    clearEntryId: z.uuid().optional(),
    /** The line's settlement revision the host saw; required with clearEntryId so a price set meanwhile is not wiped unseen. */
    expectedEntryRevision: z.number().int().min(0).optional(),
  })
  .refine((v) => !v.clearEntryId || v.expectedEntryRevision !== undefined, { message: "expectedEntryRevision is required with clearEntryId", path: ["expectedEntryRevision"] });
export type SharedPriceInput = z.infer<typeof sharedPriceSchema>;

export const serviceChargeSchema = z.object({ expectedRevision: z.number().int().min(0), centavos: centavos(MAX_SERVICE_CHARGE_CENTAVOS) });
export type ServiceChargeInput = z.infer<typeof serviceChargeSchema>;

export const receiptTotalSchema = z.object({ expectedRevision: z.number().int().min(0), centavos: centavos(MAX_SERVICE_CHARGE_CENTAVOS) });
export type ReceiptTotalInput = z.infer<typeof receiptTotalSchema>;

const adjustmentShareSchema = z
  .object({ participantId: z.uuid().optional(), billToLabel: text(LIMITS.label).min(1, "Type the person's name.").optional(), amountCentavos: z.number().int().min(0).max(MAX_SERVICE_CHARGE_CENTAVOS).optional() })
  .refine((v) => (v.participantId === undefined) !== (v.billToLabel === undefined), "Name one person.");

/** A receipt discount or extra charge. Percent is only for methods where the people (and so the basis) are known. */
export const adjustmentSchema = z
  .object({
    /** 0 creates (the id comes from the URL, so a retry never duplicates). */
    expectedRevision: z.number().int().min(0),
    direction: z.enum(["discount", "charge"]),
    category: z.enum(ADJUSTMENT_CATEGORIES),
    note: optional(LIMITS.label),
    amountCentavos: z.number().int("Use whole centavos.").min(1, "Enter an amount.").max(MAX_SERVICE_CHARGE_CENTAVOS, "That amount is too large.").optional(),
    percentBps: z.number().int().min(1, "Enter a percent.").max(10000, "That's more than 100%.").optional(),
    method: z.enum(ADJUSTMENT_METHODS),
    shares: z.array(adjustmentShareSchema).max(LIMITS.participantsPerSession),
  })
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if ((v.amountCentavos === undefined) === (v.percentBps === undefined)) return fail("Enter an amount or a percent.");
    if (v.percentBps !== undefined && (v.method === "manual" || v.method === "unallocated")) return fail("A percent needs to know who it applies to.");
    const keys = v.shares.map((s) => s.participantId ?? normalizeText(s.billToLabel ?? ""));
    if (new Set(keys).size !== keys.length) return fail("Each person can be listed once.");
    if (v.method === "unallocated" && v.shares.length > 0) return fail("Nobody is picked yet.");
    if (v.method === "individual" && v.shares.length !== 1) return fail("Pick one person.");
    if ((v.method === "proportional" || v.method === "equal" || v.method === "manual") && v.shares.length === 0) return fail("Pick at least one person.");
    const manual = v.method === "manual";
    if (v.shares.some((s) => (s.amountCentavos !== undefined) !== manual)) return fail(manual ? "Give each person an amount." : "Amounts are only for exact amounts.");
    if (manual && v.shares.reduce((sum, s) => sum + (s.amountCentavos ?? 0), 0) !== v.amountCentavos) return fail("The amounts must add up to the total.");
  });
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export const removeAdjustmentSchema = z.object({ expectedRevision: z.number().int().min(1) });

export const renameMeSchema = z.object({ displayName: text(LIMITS.label).min(1, "Type your name so the table knows whose order is whose.") });
export type RenameMeInput = z.infer<typeof renameMeSchema>;

export const servingSchema = z.object({
  roundId: z.uuid(),
  lineKey: z.string().min(1).max(600),
  delta: z.number().int().min(-999).max(999).refine((n) => n !== 0, "Nothing to change."),
});
export type ServingInput = z.infer<typeof servingSchema>;

/** Mark some (or all) of your own updates read. */
export const markReadSchema = z.union([z.strictObject({ ids: z.array(z.uuid()).min(1).max(50) }), z.strictObject({ all: z.literal(true) })]);
