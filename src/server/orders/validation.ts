import { z } from "zod";
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

export const serviceChargeSchema = z.object({ expectedRevision: z.number().int().min(0), centavos: centavos(MAX_SERVICE_CHARGE_CENTAVOS) });
export type ServiceChargeInput = z.infer<typeof serviceChargeSchema>;

export const renameMeSchema = z.object({ displayName: text(LIMITS.label).min(1, "Type your name so the table knows whose order is whose.") });
export type RenameMeInput = z.infer<typeof renameMeSchema>;
