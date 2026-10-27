import { v } from "convex/values";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { staffMutation, staffQuery } from "./lib/functions";
import {
  MAX_MESSAGE_LENGTH,
  MAX_QUESTION_LENGTH,
  QUESTION_COUNT,
  residentMessages,
} from "./lib/messages";

function checkName(value: string, what: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw appError("INVALID_INPUT", `${what} must be 2 to 80 characters.`);
  return name;
}

/** The organisation and PG details. Admin only. */
export const get = staffQuery({
  roles: [],
  args: {},
  handler: async (ctx) => {
    const { property } = ctx.staff;
    const organization = await ctx.db.get(property.organizationId);
    return {
      organizationName: organization?.name ?? "",
      propertyName: property.name,
      timezone: property.timezone,
      ...residentMessages(property),
    };
  },
});

/** Renames the organisation and/or the PG. Admin only; audited. */
export const update = staffMutation({
  roles: [],
  args: { organizationName: v.string(), propertyName: v.string() },
  handler: async (ctx, args) => {
    const organizationName = checkName(args.organizationName, "The organisation name");
    const propertyName = checkName(args.propertyName, "The PG name");
    const { property, userId } = ctx.staff;
    const organization = await ctx.db.get(property.organizationId);
    if (organization === null) throw appError("NOT_FOUND");
    await ctx.db.patch(organization._id, { name: organizationName });
    await ctx.db.patch(property._id, { name: propertyName });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "settings.updated",
      entityType: "properties",
      entityId: property._id,
      metadata: {
        before: { organizationName: organization.name, propertyName: property.name },
        after: { organizationName, propertyName },
      },
    });
    return null;
  },
});

/**
 * The question of the day (three, taking turns day by day) and the food-waste
 * message residents see above their meals. Admin only; audited.
 */
export const updateResidentMessages = staffMutation({
  roles: [],
  args: { questions: v.array(v.string()), wasteMessage: v.string() },
  handler: async (ctx, args) => {
    if (args.questions.length !== QUESTION_COUNT) {
      throw appError("INVALID_INPUT", `Enter ${QUESTION_COUNT} questions.`);
    }
    const questions = args.questions.map((q) => q.trim().replace(/\s+/g, " "));
    if (questions.some((q) => q.length < 3 || q.length > MAX_QUESTION_LENGTH)) {
      throw appError("INVALID_INPUT", `Each question must be 3 to ${MAX_QUESTION_LENGTH} characters.`);
    }
    const wasteMessage = args.wasteMessage.trim();
    if (wasteMessage.length < 10 || wasteMessage.length > MAX_MESSAGE_LENGTH) {
      throw appError("INVALID_INPUT", `The message must be 10 to ${MAX_MESSAGE_LENGTH} characters.`);
    }
    const { property, userId } = ctx.staff;
    await ctx.db.patch(property._id, { dailyQuestions: questions, wasteMessage });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "settings.updated",
      entityType: "properties",
      entityId: property._id,
      metadata: { before: residentMessages(property), after: { questions, wasteMessage } },
    });
    return null;
  },
});
