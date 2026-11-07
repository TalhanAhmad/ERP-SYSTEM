"use client";
export async function accountAction(
  action: "sign-in" | "sign-out" | "password-reset" | "password-update",
  body: unknown,
) {
  const response = await fetch(`/api/session/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-encova-csrf": "1" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message ?? "Unable to complete account request.",
    );
  return data;
}
