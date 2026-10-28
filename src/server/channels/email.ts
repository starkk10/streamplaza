import nodemailer from "nodemailer";
import { env } from "@/lib/env";

let transporter: nodemailer.Transporter | null = null;

export function emailConfigured() {
  return env.smtp.configured;
}

export async function sendEmail(to: string, subject: string, text: string) {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
    });
  }
  await transporter.sendMail({ from: env.smtp.from, to, subject, text });
}
