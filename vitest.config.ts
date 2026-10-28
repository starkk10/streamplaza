import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://streamplaza:streamplaza@localhost:54330/streamplaza_test",
      AUTH_SECRET: "a".repeat(64),
      ENCRYPTION_KEY: "b".repeat(64),
      CRON_SECRET: "cron-test-secret",
      APP_URL: "http://localhost:3000",
      UPLOAD_DIR: "./storage/test-uploads",
      WHATSAPP_APP_SECRET: "wa-app-secret",
      WHATSAPP_VERIFY_TOKEN: "wa-verify",
      // Sin credenciales de WhatsApp ni SMTP: los avisos deben quedar como "omitidos", nunca simulados como enviados
      WHATSAPP_PHONE_NUMBER_ID: "",
      WHATSAPP_ACCESS_TOKEN: "",
      SMTP_HOST: "",
    },
  },
});
