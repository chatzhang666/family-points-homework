export async function api<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!json.ok) throw new Error(json.error);
  return json.data as T;
}

export async function load<T>(view: string): Promise<T> {
  const response = await fetch(`/api/app?view=${view}`, { cache: "no-store" });
  const json = await response.json();
  if (!json.ok) throw new Error(json.error);
  return json.data as T;
}

export function showDate(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

export function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}
