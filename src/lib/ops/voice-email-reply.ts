// Apple Mail and Outlook append unprefixed history. In plain-text replies,
// individual ">" lines can also surround new answers written inline.
export function currentEmailReply(body: string | null): string {
  const lines = (body ?? "").replace(/\r\n?/g, "\n").split("\n");
  const reply: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^>/.test(line)) continue;
    if (/^-{2,}\s*(?:Original(?: Message|-Nachricht)|Ursprüngliche Nachricht|Weitergeleitete Nachricht|Forwarded message)\s*-*$/i.test(line)) break;
    if (/^(?:Von|From):\s*\S/i.test(line)) {
      const headers = lines.slice(i + 1, i + 9).map(s => s.trim()).filter(Boolean);
      if (headers.some(s => /^(?:Sent|Gesendet|Date|Datum):/i.test(s)) && headers.some(s => /^(?:To|An|Subject|Betreff):/i.test(s))) break;
    }
    if (/^(?:Am|On)\s/i.test(line)) {
      let header = line;
      let end = i;
      while (!header.endsWith(":") && end < i + 2 && lines[end + 1]?.trim()) header += " " + lines[++end].trim();
      if (/^(?:Am .{1,360}\bschrieb(?:en)?\b.{0,200}|On .{1,500}\bwrote)\s*:\s*$/iu.test(header)) {
        let next = end + 1;
        while (next < lines.length && !lines[next].trim()) next++;
        if (!lines[next]?.trimStart().startsWith(">")) break;
        i = end;
        continue;
      }
    }
    reply.push(lines[i]);
  }
  return reply.join("\n").trim();
}
