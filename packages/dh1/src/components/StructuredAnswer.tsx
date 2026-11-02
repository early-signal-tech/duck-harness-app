// A structured answer (STRUCTURED on): the summary, key findings, caveats, and the SQL
// the answer rests on, from the agent's submit_answer.

import { Markdown } from "@dh/ui-kit";
import { Detail } from "./Detail";

export interface Answer {
  summary: string;
  key_findings: string[];
  caveats: string[];
  supporting_sql: string[];
}

export function isAnswer(value: unknown): value is Answer {
  const a = value as Answer | null;
  return !!a && typeof a.summary === "string" && Array.isArray(a.key_findings) && Array.isArray(a.caveats)
    && Array.isArray(a.supporting_sql);
}

/** The answer as Markdown, for Copy. */
export function answerText(a: Answer): string {
  const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  return [
    a.summary,
    a.key_findings.length ? `**Key findings**\n${list(a.key_findings)}` : "",
    a.caveats.length ? `**Caveats**\n${list(a.caveats)}` : "",
    a.supporting_sql.length ? `**Supporting SQL**\n${a.supporting_sql.map((sql) => "```sql\n" + sql + "\n```").join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

export function StructuredAnswer({ answer }: { answer: Answer }) {
  return (
    <div className="structured">
      <Markdown text={answer.summary} />
      {answer.key_findings.length > 0 && (
        <section>
          <h3>KEY FINDINGS</h3>
          <ul>{answer.key_findings.map((f, i) => <li key={i}><Markdown text={f} /></li>)}</ul>
        </section>
      )}
      {answer.caveats.length > 0 && (
        <section>
          <h3>CAVEATS</h3>
          <ul>{answer.caveats.map((c, i) => <li key={i}><Markdown text={c} /></li>)}</ul>
        </section>
      )}
      {answer.supporting_sql.length > 0 && (
        <section>
          <h3>SUPPORTING SQL ({answer.supporting_sql.length})</h3>
          {answer.supporting_sql.map((sql, i) => <Detail key={i} text={sql} />)}
        </section>
      )}
    </div>
  );
}
