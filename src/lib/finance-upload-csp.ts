// The browser gets an upload-only capability for one private object, never a storage read URL.
export function financeUploadCsp(
  enabled: boolean,
  financePath: boolean,
  providerUrl?: string,
) {
  if (!enabled || !financePath || !providerUrl) return "";
  try {
    const u = new URL(providerUrl),
      local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/" ||
      (u.protocol !== "https:" && !(u.protocol === "http:" && local))
    )
      return "";
    return (
      " " + u.origin + "/storage/v1/object/upload/sign/encova-finance-evidence/"
    );
  } catch {
    return "";
  }
}
