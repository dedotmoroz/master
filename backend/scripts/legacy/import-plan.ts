import { createHash } from "node:crypto";
import type { LegacyRow } from "./mysql-dump.ts";
import { selectLegacyImport, summarizeLegacySelection } from "./import-selection.ts";
import { Email } from "../../src/shared/domain/value-objects.ts";
import { Order, type OrderSnapshot } from "../../src/modules/marketplace/domain/order.ts";
import { Bid, type BidSnapshot } from "../../src/modules/marketplace/domain/bid.ts";
import { ContractorProfile } from "../../src/modules/contractors/domain/contractor-profile.ts";

export const importerVersion = "2026-10-16-v1";
export function legacyId(table: string, id: string): string {
  const bytes = createHash("sha256").update(`naitimastera-legacy-v1:${table}:${id}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 128;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function minorUnits(value: string | null | undefined): number | null {
  if (value == null || value === "" || /^0+(?:\.0+)?$/.test(value)) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("LEGACY_INVALID_DECIMAL");
  const amount = BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("LEGACY_MONEY_OVERFLOW");
  return Number(amount);
}
export function legacyText(value: string | null | undefined): string {
  return (value ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").replaceAll("\0", "").trim();
}
const date = (value: string | null | undefined): string => {
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error("LEGACY_INVALID_DATE");
  return new Date(seconds * 1000).toISOString();
};
type RecordData = Record<string, unknown>;
export type LegacyMappings = { categories: ReadonlyMap<string, string>; locations: ReadonlyMap<string, string> };

export function buildImportPlan(tables: ReadonlyMap<string, readonly LegacyRow[]>, mappings: LegacyMappings) {
  const selection = selectLegacyImport(tables);
  const users = tables.get("sed_users")!;
  const userMap = new Map(users.map((r) => [r.user_id!, r]));
  const entities: RecordData[] = [];
  const roles = new Map<string, Set<string>>();
  const normalizedFields: Record<string, number> = {};
  const bounded = (value: string, limit: number, field: string) => {
    if (value.length > limit) normalizedFields[field] = (normalizedFields[field] ?? 0) + 1;
    return value.slice(0, limit);
  };
  const track = (table: string, row: LegacyRow, key: string, owner: string, metadata: RecordData = {}) => {
    entities.push({ source_table: table, legacy_id: row[key], target_id: legacyId(table, row[key]!),
      account_id: legacyId("sed_users", owner), metadata });
  };
  const grant = (id: string, capability: string) => {
    if (!userMap.has(id)) throw new Error("LEGACY_UNKNOWN_ACCOUNT");
    const current = roles.get(id) ?? new Set<string>(); current.add(capability); roles.set(id, current);
  };
  const emails = new Set<string>();
  const accounts = users.map((row) => {
    const email = Email.create(row.user_email ?? "").value;
    if (emails.has(email)) throw new Error("LEGACY_DUPLICATE_EMAIL");
    emails.add(email);
    grant(row.user_id!, row.user_maingrp === "4" ? "contractor" : "customer");
    track("sed_users", row, "user_id", row.user_id!, {
      displayName: row.user_uname, biography: row.user_about || row.user_text,
      legacyGroup: row.user_maingrp, emailVerifiedByImport: false,
    });
    return { id: legacyId("sed_users", row.user_id!), email, status: "active", created_at: date(row.user_regdate) };
  });
  for (const r of selection.candidates.orders) grant(r.item_userid!, "customer");
  for (const r of selection.candidates.bids) grant(r.item_userid!, "contractor");
  const bidGroups = new Map<string, LegacyRow[]>();
  for (const r of selection.candidates.bids) {
    const key = `${r.item_pid}:${r.item_userid}`;
    bidGroups.set(key, [...(bidGroups.get(key) ?? []), r]);
  }
  const canonical = [...bidGroups.values()].map((group) => [...group].sort((a, b) =>
    Number(b.item_choise === "performer") - Number(a.item_choise === "performer") ||
    Number(b.item_date) - Number(a.item_date) || Number(b.item_id) - Number(a.item_id))[0]!);
  const selected = new Map<string, LegacyRow>();
  for (const r of canonical.filter((r) => r.item_choise === "performer")) {
    if (selected.has(r.item_pid!)) throw new Error("LEGACY_MULTIPLE_SELECTED_BIDS");
    selected.set(r.item_pid!, r);
  }
  const orders = selection.candidates.orders.map((row) => {
    if (row.item_state !== "0" && row.item_state !== "1") throw new Error("LEGACY_UNKNOWN_ORDER_STATE");
    const category = mappings.categories.get(`projects:${row.item_cat}`);
    const location = mappings.locations.get(`city:${row.item_city}`) ?? mappings.locations.get(`region:${row.item_region}`);
    if (!category || !location) throw new Error("LEGACY_ORDER_MAPPING_MISSING");
    const winner = selected.get(row.item_id!);
    const title = legacyText(row.item_title);
    const description = legacyText(row.item_text);
    const snapshot: OrderSnapshot = { id: legacyId("sed_projects", row.item_id!), customerId: legacyId("sed_users", row.item_userid!),
      categoryId: category, locationId: location, title: bounded(title, 160, "orderTitle"), description,
      budgetMinMinor: minorUnits(row.item_cost), budgetMaxMinor: minorUnits(row.item_cost), budgetCurrency: "RUB", attachmentIds: [],
      status: winner ? "in_progress" : row.item_state === "0" ? "published" : "draft",
      selectedBidId: winner ? legacyId("sed_offers", winner.item_id!) : null,
      contractorId: winner ? legacyId("sed_users", winner.item_userid!) : null,
      createdAt: new Date(date(row.item_date)), publishedAt: row.item_state === "0" || winner ? new Date(date(row.item_date)) : null,
      completedAt: null };
    Order.restore(snapshot);
    track("sed_projects", row, "item_id", row.item_userid!, { originalTitle: title, legacyState: row.item_state });
    return { id: snapshot.id, customer_id: snapshot.customerId, category_id: category, location_id: location,
      title: snapshot.title, description, budget_min_minor: snapshot.budgetMinMinor, budget_max_minor: snapshot.budgetMaxMinor,
      budget_currency: "RUB", attachment_ids: [], status: snapshot.status, selected_bid_id: snapshot.selectedBidId,
      contractor_id: snapshot.contractorId, created_at: date(row.item_date), published_at: snapshot.publishedAt?.toISOString() ?? null, completed_at: null };
  });
  const versions: RecordData[] = [];
  const bids = canonical.map((row) => {
    const winner = selected.get(row.item_pid!);
    if (row.item_time_type !== "1" && (Number(row.item_time_min) > 0 || Number(row.item_time_max) > 0)) throw new Error("LEGACY_DURATION_CONVERSION_REQUIRED");
    const message = legacyText(row.item_text);
    const status = row.item_choise === "performer" ? "selected" : row.item_choise === "refuse" || winner ? "rejected" : "submitted";
    const snapshot: BidSnapshot = { id: legacyId("sed_offers", row.item_id!), orderId: legacyId("sed_projects", row.item_pid!),
      contractorId: legacyId("sed_users", row.item_userid!), message: bounded(message, 5000, "bidMessage"),
      priceMinMinor: minorUnits(row.item_cost_min), priceMaxMinor: minorUnits(row.item_cost_max), priceCurrency: "RUB",
      durationDaysMin: Number(row.item_time_min) > 0 ? Number(row.item_time_min) : null,
      durationDaysMax: Number(row.item_time_max) > 0 ? Number(row.item_time_max) : null,
      visibility: row.item_hidden === "1" ? "private" : "public", status,
      submittedAt: new Date(date(row.item_date)), decidedAt: Number(row.item_choise_date) > 0 ? new Date(date(row.item_choise_date)) : null };
    Bid.restore(snapshot);
    for (const revision of bidGroups.get(`${row.item_pid}:${row.item_userid}`)!) {
      track("sed_offers", revision, "item_id", revision.item_userid!, { canonicalBidId: snapshot.id,
        priceMin: revision.item_cost_min, priceMax: revision.item_cost_max, timeMin: revision.item_time_min,
        timeMax: revision.item_time_max, timeType: revision.item_time_type });
      versions.push({ id: legacyId("sed_offers", revision.item_id!), legacy_id: revision.item_id, bid_id: snapshot.id,
        contractor_id: snapshot.contractorId, message: legacyText(revision.item_text), original_choice: revision.item_choise,
        visibility: revision.item_hidden === "1" ? "private" : "public", submitted_at: date(revision.item_date) });
    }
    return { id: snapshot.id, order_id: snapshot.orderId, contractor_id: snapshot.contractorId, message: snapshot.message,
      price_min_minor: snapshot.priceMinMinor, price_max_minor: snapshot.priceMaxMinor, price_currency: "RUB",
      duration_days_min: snapshot.durationDaysMin, duration_days_max: snapshot.durationDaysMax, visibility: snapshot.visibility,
      status: snapshot.status, submitted_at: date(row.item_date), decided_at: snapshot.decidedAt?.toISOString() ?? null };
  });
  const specializationGroups = new Map<string, Set<string>>();
  for (const r of tables.get("sed_freelancers_scat") ?? []) {
    if (!userMap.has(r.item_userid!)) continue;
    const category = mappings.categories.get(`freelancers:${r.item_scat}`);
    if (!category) throw new Error("LEGACY_SPECIALIZATION_MAPPING_MISSING");
    const group = specializationGroups.get(r.item_userid!) ?? new Set<string>(); group.add(category); specializationGroups.set(r.item_userid!, group);
  }
  const specializations: RecordData[] = [];
  const serviceAreas: RecordData[] = [];
  const profiles = users.filter((r) => roles.get(r.user_id!)?.has("contractor")).map((row) => {
    const name = legacyText(row.user_uname || [row.user_fname, row.user_sname].filter(Boolean).join(" ") || row.user_firmname || row.user_name);
    const bio = legacyText(row.user_about || row.user_text);
    const categories = [...(specializationGroups.get(row.user_id!) ?? [])];
    const location = mappings.locations.get(`city:${row.user_location}`) ?? mappings.locations.get(`region:${row.user_region}`);
    const details = { accountId: legacyId("sed_users", row.user_id!), displayName: bounded(name, 120, "profileName"),
      bio: bounded(bio, 5000, "profileBio"), avatarAttachmentId: null, specializationIds: categories,
      serviceLocationIds: location ? [location] : [], portfolio: [], createdAt: new Date(date(row.user_regdate)), updatedAt: new Date(date(row.user_regdate)) };
    ContractorProfile.restore(details);
    for (const category of categories) specializations.push({ account_id: details.accountId, category_id: category });
    if (location) serviceAreas.push({ account_id: details.accountId, location_id: location });
    return { account_id: details.accountId, display_name: details.displayName, bio: details.bio, avatar_attachment_id: null,
      portfolio: [], created_at: date(row.user_regdate), updated_at: date(row.user_regdate) };
  });
  const reviews = (tables.get("sed_reviews") ?? []).map((row) => {
    if (!userMap.has(row.item_userid!) || !userMap.has(row.item_touserid!) || !["-1", "1"].includes(row.item_score!)) throw new Error("LEGACY_REVIEW_INVALID");
    return { id: legacyId("sed_reviews", row.item_id!), legacy_id: row.item_id, author_id: legacyId("sed_users", row.item_userid!),
      subject_id: legacyId("sed_users", row.item_touserid!), score: Number(row.item_score), text: legacyText(row.item_text), created_at: date(row.item_date) };
  });
  const capabilities = [...roles].flatMap(([id, group]) => [...group].map((capability) => ({ account_id: legacyId("sed_users", id), capability })));
  return { accounts, capabilities, profiles, specializations, serviceAreas, orders, bids, versions, reviews, entities,
    selection, report: { selection: summarizeLegacySelection(selection), accounts: accounts.length, profiles: profiles.length,
      orders: orders.length, publishedOrders: orders.filter((o) => o.status === "published").length,
      bids: bids.length, bidVersions: versions.length, historicalReviews: reviews.length, normalizedFields } };
}
