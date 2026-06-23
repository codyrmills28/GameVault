import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

const JWT_SECRET = process.env.JWT_SECRET || "gamevault_secret_fallback_key_123";
export const AUTH_COOKIE_NAME = "gv_session";

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(password, hash);
  } catch (e) {
    return false;
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string };
  } catch (error) {
    return null;
  }
}

export async function getAuthenticatedUser() {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    
    if (!token) return null;
    
    const payload = verifyToken(token);
    if (!payload) return null;
    
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        subscription: true,
      },
    });
    
    if (!user) return null;
    
    // Don't leak password hash
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  } catch (error) {
    return null;
  }
}

export function setAuthCookie(token: string) {
  const cookieStore = cookies();
  cookieStore.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
}

export function deleteAuthCookie() {
  const cookieStore = cookies();
  cookieStore.set(AUTH_COOKIE_NAME, "", {
    maxAge: -1,
    path: "/",
  });
}
