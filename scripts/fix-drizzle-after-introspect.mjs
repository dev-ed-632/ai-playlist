import fs from "node:fs";

const schemaPath = new URL("../drizzle/schema.ts", import.meta.url);
let schema = fs.readFileSync(schemaPath, "utf8");
if (schema.includes(".default(').notNull()")) {
  schema = schema.replace(/\.default\('\)\.notNull\(\)/g, '.default("").notNull()');
  fs.writeFileSync(schemaPath, schema);
}

const relPath = new URL("../drizzle/relations.ts", import.meta.url);
let rel = fs.readFileSync(relPath, "utf8");
if (/import\s*\{\s*\}\s*from/.test(rel)) {
  fs.writeFileSync(relPath, "export {};\n");
}
