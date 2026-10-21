export type LegacyRow = Readonly<Record<string, string | null>>;

// Offline reader for phpMyAdmin INSERT ... VALUES dumps, NOT a SQL executor.
// Fail closed on unsupported INSERT syntax. Never include source values in errors.
function* statements(sql: string): Generator<string> {
  let buffer = "";
  let quote = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (quote) {
      buffer += c;
      if (c === "\\") { buffer += sql[++i] ?? ""; }
      else if (c === quote) {
        if (sql[i + 1] === quote) buffer += sql[++i];
        else quote = "";
      }
    } else if (c === "'" || c === '"' || c === "`") {
      quote = c; buffer += c;
    } else if ((c === "-" && sql[i + 1] === "-" && /\s/.test(sql[i + 2] ?? "")) || c === "#") {
      while (i < sql.length && sql[i] !== "\n") i++;
      buffer += "\n";
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Unterminated SQL comment");
      i = end + 1; buffer += " ";
    } else if (c === ";") {
      yield buffer.trim(); buffer = "";
    } else buffer += c;
  }
  if (quote) throw new Error("Unterminated SQL string");
  if (buffer.trim()) yield buffer.trim();
}

function parseValues(input: string): Array<Array<string | null>> {
  const rows: Array<Array<string | null>> = [];
  let i = 0;
  const whitespace = () => { while (/\s/.test(input[i] ?? "") && i < input.length) i++; };
  while (i < input.length) {
    whitespace();
    if (input[i++] !== "(") throw new Error("Unsupported SQL values syntax");
    const values: Array<string | null> = [];
    while (true) {
      whitespace();
      let value = "";
      if (input[i] === "'") {
        i++;
        let closed = false;
        while (i < input.length) {
          const c = input[i++]!;
          if (c === "\\") {
            const escaped = input[i++];
            if (escaped === undefined) throw new Error("Unterminated SQL escape");
            const escapes: Record<string, string> = { "0": "\0", n: "\n", r: "\r", t: "\t", b: "\b", Z: "\x1a" };
            value += escapes[escaped] ?? (escaped === "%" || escaped === "_" ? `\\${escaped}` : escaped);
          } else if (c === "'") {
            if (input[i] === "'") { value += "'"; i++; }
            else { closed = true; break; }
          } else value += c;
        }
        if (!closed) throw new Error("Unterminated SQL value");
        values.push(value);
      } else {
        const start = i;
        while (i < input.length && input[i] !== "," && input[i] !== ")") i++;
        const literal = input.slice(start, i).trim();
        if (!/^(NULL|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|0x[\da-f]+)$/i.test(literal)) {
          throw new Error("Unsupported SQL literal");
        }
        values.push(literal.toUpperCase() === "NULL" ? null : literal);
      }
      whitespace();
      const separator = input[i++];
      if (separator === ")") break;
      if (separator !== ",") throw new Error("Invalid SQL value separator");
    }
    rows.push(values);
    whitespace();
    if (i === input.length) break;
    if (input[i++] !== ",") throw new Error("Invalid SQL row separator");
  }
  return rows;
}

export function readMysqlDump(sql: string): Map<string, LegacyRow[]> {
  const tables = new Map<string, LegacyRow[]>();
  for (const statement of statements(sql)) {
    const create = /^CREATE TABLE `([a-zA-Z0-9_]+)`\s*\(/i.exec(statement);
    if (create && !tables.has(create[1]!)) tables.set(create[1]!, []);
    if (!/^INSERT\b/i.test(statement)) continue;
    const insert = /^INSERT INTO `([a-zA-Z0-9_]+)`\s*\(([^)]+)\)\s+VALUES\s*/i.exec(statement);
    if (!insert) throw new Error("Unsupported INSERT statement");
    const columns = insert[2]!.split(",").map((c) => c.trim().replace(/^`|`$/g, ""));
    if (columns.some((c) => !/^[a-zA-Z0-9_]+$/.test(c)) || new Set(columns).size !== columns.length) {
      throw new Error("Invalid INSERT columns");
    }
    const rows = tables.get(insert[1]!) ?? [];
    for (const values of parseValues(statement.slice(insert[0].length))) {
      if (values.length !== columns.length) throw new Error("INSERT column count mismatch");
      rows.push(Object.fromEntries(columns.map((c, index) => [c, values[index]!])));
    }
    tables.set(insert[1]!, rows);
  }
  return tables;
}
