import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "./auth";

// Resolve the current user from the session cookie, or null.
export async function getAuthUser(): Promise<SessionPayload | null> {
  return getSession();
}

export function unauthorized() {
  return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function serverError(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}
