export async function register() {
  const storage = globalThis.localStorage as Storage | undefined;

  if (typeof storage !== "undefined" && typeof storage.getItem !== "function") {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
}
