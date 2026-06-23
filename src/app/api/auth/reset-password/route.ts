import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      // Security best practice: don't reveal if email exists, return success
      return NextResponse.json({
        success: true,
        message: "If the email exists, a password reset link has been sent.",
      });
    }

    // Mock reset: We will reset the password to "password123" for development ease,
    // and log this action.
    const newPasswordHash = hashPassword("password123");
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "RESET_PASSWORD",
        details: "Password reset request. Dev-mode: Reset password to 'password123'.",
      },
    });

    return NextResponse.json({
      success: true,
      message: "If the email exists, a password reset link has been sent. (Development Mode: Password reset to 'password123')",
    });
  } catch (error) {
    console.error("Reset Password API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
