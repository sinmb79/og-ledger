import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { schemaSql } from "./schema";

const dataDirPath = path.resolve(__dirname, "../../data");
const dbPath = path.resolve(dataDirPath, "og-ledger.db");

if (!fs.existsSync(dataDirPath)) {
  fs.mkdirSync(dataDirPath, { recursive: true });
}

export const db = new Database(dbPath);

export function initializeDb(): void {
  db.exec(schemaSql);
}

export function getDbPath(): string {
  return dbPath;
}
