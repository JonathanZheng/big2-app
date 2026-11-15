/**
 * Test-only helpers: a stand-in for the Supabase client. Every query chain,
 * such as from("rooms").select("*").eq("id", x), is recorded when awaited and
 * answered by `respond`, so tests can script replies and check what was sent.
 */

export interface Query {
  /** The table name, or "rpc:<name>" for a database function. */
  table: string;
  steps: { method: string; args: unknown[] }[];
}

export interface Reply {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

/** The arguments of the first call to `method` in a query. */
export function args(query: Query, method: string): unknown[] | undefined {
  return query.steps.find((s) => s.method === method)?.args;
}

/** Whether a query starts with this table and contains this method. */
export function is(query: Query, table: string, method: string): boolean {
  return query.table === table && query.steps.some((s) => s.method === method);
}

export function fakeSupabase(respond: (query: Query) => Reply = () => ({})) {
  const queries: Query[] = [];
  const chain = (query: Query): unknown => new Proxy({}, {
    get(_, prop) {
      if (prop === "then") {
        queries.push(query);
        const reply = respond(query);
        const result = { data: reply.data ?? null, error: reply.error ?? null };
        return (resolve: (r: typeof result) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject);
      }
      return (...callArgs: unknown[]) => chain({ ...query, steps: [...query.steps, { method: String(prop), args: callArgs }] });
    },
  });
  return {
    queries,
    from: (table: string) => chain({ table, steps: [] }),
    rpc: (name: string, params: unknown) => chain({ table: `rpc:${name}`, steps: [{ method: "rpc", args: [params] }] }),
    auth: {
      getUser: async (_token: string): Promise<{ data: { user: unknown }; error: { message: string } | null }> =>
        ({ data: { user: null }, error: null }),
    },
  };
}

export type FakeSupabase = ReturnType<typeof fakeSupabase>;
