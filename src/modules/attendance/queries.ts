import { z } from "zod";
import { workDate } from "@/lib/dates";
export const attendanceQuerySchema = z
  .object({
    date: z.iso.date().default(() => workDate()),
    status: z
      .enum(["all", "checked-in", "checked-out", "not-checked-in", "on-leave"])
      .default("all"),
    q: z.string().trim().max(100).default(""),
  })
  .strict()
  .refine((v) => v.date <= workDate(), {
    message: "Choose today or an earlier attendance date.",
    path: ["date"],
  });
