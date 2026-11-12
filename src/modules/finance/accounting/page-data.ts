import "server-only";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { context, type Actor } from "@/server/context";
import { AppError } from "@/server/errors";
import { financeStatus, requireFinanceEnabled } from "../access/policy";
export async function financePageData<T>(
  query: (actor: Actor) => Promise<T>,
): Promise<T> {
  try {
    requireFinanceEnabled();
    const actor = await context();
    await financeStatus(actor);
    return await query(actor);
  } catch (error) {
    if (error instanceof AppError) {
      if (error.status === 401) redirect("/login");
      if (error.code === "MFA_REQUIRED") redirect("/security");
      if ([403, 404].includes(error.status)) notFound();
    }
    if (error instanceof z.ZodError) notFound();
    throw error;
  }
}
