import { BidMessage } from "../../../modules/marketplace/domain/bid-message.ts";
import type { BidMessageRepository, ConversationMessage } from "../../../modules/marketplace/application/bid-messages.ts";
import type { PgDatabase } from "./database.ts";

type Row = { id: string; bid_id: string; order_id: string; author_id: string; client_message_id: string; text: string; created_at: Date };
export class PgBidMessageRepository implements BidMessageRepository {
  readonly #db: PgDatabase;
  constructor(database: PgDatabase) { this.#db = database; }
  async save(message: BidMessage): Promise<void> {
    this.#db.requireTransaction("Saving a private message");
    const s = message.toSnapshot();
    await this.#db.query(`INSERT INTO bid_messages(id,bid_id,order_id,author_id,client_message_id,text,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [s.id,s.bidId,s.orderId,s.authorId,s.clientMessageId,s.text,s.createdAt]);
  }
  async findByClientId(bidId: string, authorId: string, clientMessageId: string): Promise<BidMessage | null> {
    const result = await this.#db.query<Row>("SELECT * FROM bid_messages WHERE bid_id=$1 AND author_id=$2 AND client_message_id=$3", [bidId,authorId,clientMessageId]);
    const r = result.rows[0];
    return r ? BidMessage.restore({ id:r.id,bidId:r.bid_id,orderId:r.order_id,authorId:r.author_id,
      clientMessageId:r.client_message_id,text:r.text,createdAt:r.created_at }) : null;
  }
  async list(bidId: string, pagination: Readonly<{ limit: number; offset: number }>) {
    const [data, count] = await Promise.all([
      this.#db.query<Omit<Row, "author_id"> & { author_id: string | null }>(`SELECT * FROM bid_conversation_messages WHERE bid_id=$1
        ORDER BY created_at DESC,id DESC,origin DESC LIMIT $2 OFFSET $3`, [bidId,pagination.limit,pagination.offset]),
      this.#db.query<{ total: string }>("SELECT count(*) AS total FROM bid_conversation_messages WHERE bid_id=$1", [bidId]),
    ]);
    const items: ConversationMessage[] = data.rows.map((r) => ({ id:r.id,bidId:r.bid_id,orderId:r.order_id,
      authorId:r.author_id,text:r.text,createdAt:r.created_at }));
    return { items,total:Number(count.rows[0]?.total ?? 0),...pagination };
  }
}
