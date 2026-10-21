export type DomainEvent<TPayload extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> = Readonly<{
  name: string;
  aggregateId: string;
  occurredAt: Date;
  payload: TPayload;
}>;

export abstract class AggregateRoot {
  #events: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.#events.push(event);
  }

  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }
}
