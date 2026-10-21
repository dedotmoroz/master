import type { LegacyRow } from "./mysql-dump.ts";

// Selection only: no writes, status conversion, ownership guesses or file deletion.
export function selectLegacyImport(tables: ReadonlyMap<string, readonly LegacyRow[]>) {
  const required = (table: string) => {
    const data = tables.get(table);
    if (!data) throw new Error(`Required legacy table is missing: ${table}`);
    return data;
  };
  const users = required("sed_users");
  const projects = required("sed_projects");
  const offers = required("sed_offers");
  const attachments = required("sed_attachs");
  const userIds = new Set(users.map((r) => r.user_id));
  const excludedProjects = projects.filter((r) => !r.item_userid || r.item_userid === "0" || !userIds.has(r.item_userid)
    || !r.item_text?.trim() || r.item_state === "-1");
  const excludedOrderIds = new Set(excludedProjects.map((r) => r.item_id));
  const excludedOffers = offers.filter((r) => excludedOrderIds.has(r.item_pid)
    || !r.item_userid || !userIds.has(r.item_userid) || !r.item_text?.trim());
  const excludedOfferIds = new Set(excludedOffers.map((r) => r.item_id));
  const excludedAttachments = attachments.filter((r) => excludedOrderIds.has(r.att_pid));
  const posts = tables.get("sed_projects_posts") ?? [];
  const excludedPosts = posts.filter((r) => excludedOrderIds.has(r.post_pid) || excludedOfferIds.has(r.post_oid));
  const keep = (all: readonly LegacyRow[], excluded: readonly LegacyRow[]) => {
    const rejected = new Set(excluded);
    return all.filter((r) => !rejected.has(r));
  };
  return {
    excluded: { orders: excludedProjects, bids: excludedOffers, orderAttachments: excludedAttachments, bidMessages: excludedPosts },
    candidates: { orders: keep(projects, excludedProjects), bids: keep(offers, excludedOffers),
      orderAttachments: keep(attachments, excludedAttachments), bidMessages: keep(posts, excludedPosts) },
  };
}

export function summarizeLegacySelection(selection: ReturnType<typeof selectLegacyImport>) {
  const counts = (group: typeof selection.candidates) => Object.fromEntries(
    Object.entries(group).map(([name, rows]) => [name, rows.length]),
  );
  return { mode: "dry-run", sourceModified: false, databaseModified: false,
    orderPolicy: "preserve-original-publication-no-age-archiving",
    exclusionReasons: ["ORDER_OWNER_MISSING", "ORDER_DESCRIPTION_EMPTY", "ORDER_DELETED", "BID_CONTRACTOR_MISSING", "BID_MESSAGE_EMPTY", "EXCLUDED_PARENT"],
    excluded: counts(selection.excluded),
    // These records still require mapping/validation. Candidate does not mean import-ready.
    candidatesForValidation: counts(selection.candidates) };
}
