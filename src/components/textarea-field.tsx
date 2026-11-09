"use client";
import { useId, type TextareaHTMLAttributes } from "react";
export function TextareaField({
  label,
  ...props
}: { label: string } & Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id" | "aria-label" | "aria-labelledby"
>) {
  const id = useId();
  return (
    <label htmlFor={id}>
      <span id={id + "-label"}>{label}</span>
      <textarea {...props} id={id} aria-labelledby={id + "-label"} />
    </label>
  );
}
