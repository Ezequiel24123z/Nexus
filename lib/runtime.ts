import { getChatGPTUser } from "@/app/chatgpt-auth";

export async function runtimeOwnerId() {
  const user = await getChatGPTUser();
  // Local preview does not have an authenticated ChatGPT user. This keeps the
  // developer experience usable without weakening the hosted Site's access policy.
  return user?.userId ?? "local-operator";
}

export function nowIso() {
  return new Date().toISOString();
}

export function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("D1 binding")) {
    return "El almacenamiento aún no está disponible. La ejecución puede continuar, pero no se guardará en el historial.";
  }
  return message;
}

export function safeUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("La URL del conector no es válida.");
  }

  if (url.protocol !== "https:" || !url.hostname) {
    throw new Error("Los conectores solo admiten endpoints HTTPS públicos.");
  }

  const host = url.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

  if (blocked) throw new Error("Ese destino no es un endpoint público permitido.");
  return url;
}

export function boundedText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
