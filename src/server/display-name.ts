// Email has already been validated by the identity boundary.
export function displayName(name: string | null | undefined, email: string) {
  return name?.trim() || email.split("@")[0];
}
