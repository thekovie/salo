import { z } from "zod";

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
