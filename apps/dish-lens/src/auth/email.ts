import { Resend } from "resend";
import { config } from "../config.js";

const resend = new Resend(config.RESEND_API_KEY);

export async function sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
  await resend.emails.send({
    from: config.EMAIL_FROM,
    to,
    subject: "Verify your DishLens email",
    html: `<p>Click <a href="${verificationUrl}">here</a> to verify your email address.</p><p>This link expires in 24 hours. If you didn't create a DishLens account, ignore this email.</p>`,
  });
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  await resend.emails.send({
    from: config.EMAIL_FROM,
    to,
    subject: "Your DishLens login code",
    html: `<p>Your one-time login code is:</p><h2>${code}</h2><p>This code expires in 10 minutes. If you didn't request it, ignore this email.</p>`,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await resend.emails.send({
    from: config.EMAIL_FROM,
    to,
    subject: "Reset your DishLens password",
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password.</p><p>This link expires in 1 hour. If you didn't request a reset, ignore this email.</p>`,
  });
}
