// Creates build/template.db: all migrations applied, no rows. Shipped in the
// installer and copied to userData on first launch. Uses the same migration
// runner as the app so the template matches what existing installs converge to.
"use strict";
const fs = require("fs");
const path = require("path");
const { runMigrations } = require("../electron/migrate");
const { PrismaClient } = require("../src/generated/client");

const out = path.join(__dirname, "..", "build", "template.db");
fs.mkdirSync(path.dirname(out), { recursive: true });
if (fs.existsSync(out)) fs.unlinkSync(out);

runMigrations({
  dbPath: out,
  migrationsDir: path.join(__dirname, "..", "prisma", "migrations"),
  backupDir: path.join(__dirname, "..", "build", "_tmpbackups"),
  makeClient: (url) => new PrismaClient({ datasources: { db: { url } } }),
})
  .then((res) => {
    console.log("Template DB created at", out, "— applied:", res.applied.join(", "));
  })
  .catch((err) => {
    console.error("Template DB build failed:", err);
    process.exit(1);
  });
