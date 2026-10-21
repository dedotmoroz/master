import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readMysqlDump, type LegacyRow } from "./legacy/mysql-dump.ts";
import { selectLegacyImport, summarizeLegacySelection } from "./legacy/import-selection.ts";
import { Email } from "../src/shared/domain/value-objects.ts";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const dumpPath = resolve(process.argv[2] ?? resolve(backendRoot, "../naitimastera.sql"));
const filesRoot = await realpath(resolve(process.argv[3] ?? resolve(backendRoot, "../naitimastera")));
const sql = await readFile(dumpPath, "utf8");
const tables = readMysqlDump(sql);
const rows = (table: string) => tables.get(table) ?? [];
const count = (table: string, predicate: (row: LegacyRow) => boolean) => rows(table).filter(predicate).length;
const text = (row: LegacyRow, field: string) => row[field] ?? "";
const index = (table: string, field: string) => new Map(rows(table).map((row) => [text(row, field), row]));
const distribution = (table: string, field: string, allowed: readonly string[]) => Object.fromEntries(
  [...allowed, "other"].map((value) => [value, count(table, (row) => value === "other"
    ? !allowed.includes(text(row, field)) : text(row, field) === value)]));
const duplicateGroups = (table: string, key: (row: LegacyRow) => string) => {
  const groups = new Map<string, number>();
  for (const row of rows(table)) { const value = key(row); groups.set(value, (groups.get(value) ?? 0) + 1); }
  const sizes = [...groups.values()].filter((n) => n > 1);
  return { groups: sizes.length, affectedRows: sizes.reduce((sum, n) => sum + n, 0) };
};
const users = index("sed_users", "user_id");
const projects = index("sed_projects", "item_id");
const offers = rows("sed_offers");
const mappingKeys = async (name: string) => new Set([...(
  await readFile(resolve(backendRoot, "migrations", name), "utf8")
).matchAll(/\('([a-z]+)',\s*(\d+),\s*'[^']+'\)/g)].map((match) => `${match[1]}:${match[2]}`));
const categories = await mappingKeys("009_work_categories.sql");
const locations = await mappingKeys("010_russian_geography.sql");
const selectedByOrder = new Map<string, LegacyRow[]>();
for (const offer of offers.filter((o) => o.item_choise === "performer")) {
  const key = text(offer, "item_pid");
  selectedByOrder.set(key, [...(selectedByOrder.get(key) ?? []), offer]);
}
const validEmail = (row: LegacyRow) => {
  try { Email.create(text(row, "user_email")); return true; } catch { return false; }
};

async function inspectFiles(table: string, field: string) {
  const result = { references: 0, found: 0, missing: 0, unsafeOrExternal: 0 };
  for (const row of rows(table)) {
    const path = text(row, field).trim();
    if (!path) continue;
    result.references++;
    if (isAbsolute(path) || /^[a-z]+:/i.test(path) || path.includes("\\") || path.includes("\0")) {
      result.unsafeOrExternal++; continue;
    }
    const inside = (candidate: string) => { const rel = relative(filesRoot, candidate); return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
    const candidate = resolve(filesRoot, path);
    if (!inside(candidate)) { result.unsafeOrExternal++; continue; }
    try {
      const target = await realpath(candidate);
      if (!inside(target)) result.unsafeOrExternal++;
      else if ((await stat(target)).isFile()) result.found++;
      else result.missing++;
    } catch (error) {
      if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) result.missing++;
      else throw new Error("Cannot inspect legacy file metadata");
    }
  }
  return result;
}

const orderDates = rows("sed_projects").map((r) => Number(r.item_date)).filter((n) => n > 0 && Number.isFinite(n));
const report = {
  source: { file: relative(dirname(backendRoot), dumpPath), bytes: Buffer.byteLength(sql),
    sha256: createHash("sha256").update(sql).digest("hex"),
    tables: tables.size, orderDateRange: orderDates.length ? {
      earliest: new Date(Math.min(...orderDates) * 1000).toISOString(), latest: new Date(Math.max(...orderDates) * 1000).toISOString(),
    } : null },
  tableCounts: Object.fromEntries([...tables].map(([table, data]) => [table, data.length])),
  importSelection: summarizeLegacySelection(selectLegacyImport(tables)),
  accounts: {
    invalidEmail: count("sed_users", (r) => !validEmail(r)),
    duplicateNormalizedEmail: duplicateGroups("sed_users", (r) => text(r, "user_email").trim().toLowerCase()),
    mainGroups: distribution("sed_users", "user_maingrp", ["-1", "1", "2", "3", "4", "5", "6", "8"]),
    registrationTypes: distribution("sed_users", "user_regtype", ["", "freelancers", "employers"]),
    zeroRegistrationDate: count("sed_users", (r) => Number(r.user_regdate) <= 0),
    populatedOldEmailTokens: count("sed_users", (r) => Boolean(r.user_email_auth_string)),
  },
  orders: {
    states: distribution("sed_projects", "item_state", ["-1", "0", "1", "2", "3", "4", "5"]),
    missingOwner: count("sed_projects", (r) => !users.has(text(r, "item_userid"))),
    zeroOwner: count("sed_projects", (r) => Number(r.item_userid) === 0),
    ownerHasInvalidEmail: count("sed_projects", (r) => { const user = users.get(text(r, "item_userid")); return Boolean(user && !validEmail(user)); }),
    unmappedCategory: count("sed_projects", (r) => !categories.has(`projects:${r.item_cat}`)),
    unmappedCityInOldCatalog: count("sed_projects", (r) => !locations.has(`city:${r.item_city}`)),
    unmappedRegionInOldCatalog: count("sed_projects", (r) => !locations.has(`region:${r.item_region}`)),
    unmappedLocationInNewerCatalog: count("sed_projects", (r) => !locations.has(`locations:${r.item_city}`)),
    regionFallbackAvailable: count("sed_projects", (r) => !locations.has(`city:${r.item_city}`) && locations.has(`region:${r.item_region}`)),
    noCityOrRegionMapping: count("sed_projects", (r) => !locations.has(`city:${r.item_city}`) && !locations.has(`region:${r.item_region}`)),
    emptyDescription: count("sed_projects", (r) => !text(r, "item_text").trim()),
    emptyTitle: count("sed_projects", (r) => !text(r, "item_title").trim()),
    longTitle: count("sed_projects", (r) => text(r, "item_title").trim().length > 160),
    longDescription: count("sed_projects", (r) => text(r, "item_text").trim().length > 10_000),
    zeroOrUnsetBudget: count("sed_projects", (r) => Number(r.item_cost) === 0),
    negativeBudget: count("sed_projects", (r) => Number(r.item_cost) < 0),
    withSelectedContractor: selectedByOrder.size,
    multipleSelectedOffers: [...selectedByOrder.values()].filter((group) => group.length > 1).length,
  },
  bids: {
    choices: distribution("sed_offers", "item_choise", ["", "performer", "refuse"]),
    timeUnits: distribution("sed_offers", "item_time_type", ["0", "1", "2"]),
    visibility: distribution("sed_offers", "item_hidden", ["0", "1"]),
    missingOrder: count("sed_offers", (r) => !projects.has(text(r, "item_pid"))),
    missingContractor: count("sed_offers", (r) => !users.has(text(r, "item_userid"))),
    orderHasMissingOwner: count("sed_offers", (r) => { const p = projects.get(text(r, "item_pid")); return Boolean(p && !users.has(text(p, "item_userid"))); }),
    selfBid: count("sed_offers", (r) => projects.get(text(r, "item_pid"))?.item_userid === r.item_userid),
    duplicateOrderContractor: duplicateGroups("sed_offers", (r) => `${r.item_pid}:${r.item_userid}`),
    emptyMessage: count("sed_offers", (r) => !text(r, "item_text").trim()),
    positiveHourlyDuration: count("sed_offers", (r) => r.item_time_type === "0" && (Number(r.item_time_min) > 0 || Number(r.item_time_max) > 0)),
    reversedPrice: count("sed_offers", (r) => Number(r.item_cost_min) > 0 && Number(r.item_cost_max) > 0 && Number(r.item_cost_min) > Number(r.item_cost_max)),
    reversedDuration: count("sed_offers", (r) => Number(r.item_time_min) > 0 && Number(r.item_time_max) > 0 && Number(r.item_time_min) > Number(r.item_time_max)),
  },
  reviews: {
    scores: distribution("sed_reviews", "item_score", ["-5", "-4", "-3", "-2", "-1", "0", "1", "2", "3", "4", "5"]),
    noOrder: count("sed_reviews", (r) => Number(r.item_pid) === 0),
    missingOrder: count("sed_reviews", (r) => Number(r.item_pid) !== 0 && !projects.has(text(r, "item_pid"))),
    missingAuthor: count("sed_reviews", (r) => !users.has(text(r, "item_userid"))),
    missingSubject: count("sed_reviews", (r) => !users.has(text(r, "item_touserid"))),
    selfReview: count("sed_reviews", (r) => r.item_userid === r.item_touserid),
    duplicateTriple: duplicateGroups("sed_reviews", (r) => `${r.item_pid}:${r.item_userid}:${r.item_touserid}`),
    matchingSelectedParticipants: count("sed_reviews", (r) => {
      const project = projects.get(text(r, "item_pid"));
      return Boolean(project && (selectedByOrder.get(text(r, "item_pid")) ?? []).some((offer) =>
        (r.item_userid === project.item_userid && r.item_touserid === offer.item_userid) ||
        (r.item_touserid === project.item_userid && r.item_userid === offer.item_userid)));
    }),
  },
  profiles: {
    unmappedUserLocationInOldCatalog: count("sed_users", (r) => Number(r.user_location) > 0 && !locations.has(`city:${r.user_location}`)),
    unmappedUserLocationInNewerCatalog: count("sed_users", (r) => Number(r.user_location) > 0 && !locations.has(`locations:${r.user_location}`)),
    specializationRowsMissingUser: count("sed_freelancers_scat", (r) => !users.has(text(r, "item_userid"))),
    unmappedSpecializationRows: count("sed_freelancers_scat", (r) => !categories.has(`freelancers:${r.item_scat}`)),
    duplicateSpecializations: duplicateGroups("sed_freelancers_scat", (r) => `${r.item_userid}:${r.item_scat}`),
    portfolioMissingUser: count("sed_portfolio", (r) => !users.has(text(r, "item_userid"))),
  },
  files: {
    orderAttachments: await inspectFiles("sed_attachs", "att_file"),
    portfolio: await inspectFiles("sed_portfolio", "item_img"),
    avatars: await inspectFiles("sed_users", "user_avatar"),
    photos: await inspectFiles("sed_users", "user_photo"),
    orphanOrderAttachments: count("sed_attachs", (r) => !projects.has(text(r, "att_pid"))),
  },
};
console.log(JSON.stringify(report, null, 2));
