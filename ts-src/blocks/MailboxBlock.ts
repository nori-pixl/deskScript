import { BlockContext } from './BlockContext';

// 8a. outbox:send(key, value) デスク間メッセージ送信
export function processOutboxSend(
  content: string,
  hostScope: Record<string, any>,
  disScope: Record<string, any>,
  ctx: BlockContext
): string {
  const regex = /outbox:send\(([^)]+)\)/g;
  return content.replace(regex, (_match, argsRaw) => {
    const parts = ctx.splitTopLevel(argsRaw, ',');
    const key = (parts[0] || '').trim().replace(/^["']|["']$/g, '');
    const valueToken = (parts[1] || '').trim();
    const value = ctx.resolveValue(valueToken, hostScope, disScope);
    ctx.mailbox.set(key, value);
    return JSON.stringify(`[Outbox] 「${key}」宛にメッセージを送信しました。`);
  });
}

// 8b. inbox:receive(key) デスク間メッセージ受信
export function processInboxReceive(content: string, ctx: BlockContext): string {
  const regex = /inbox:receive\(([^)]+)\)/g;
  return content.replace(regex, (_match, keyRaw) => {
    const key = keyRaw.trim().replace(/^["']|["']$/g, '');
    if (ctx.mailbox.has(key)) {
      return JSON.stringify(`[Inbox] 「${key}」からのメッセージ: ${ctx.mailbox.get(key)}`);
    }
    return JSON.stringify(`[Inbox] 「${key}」宛の未読メッセージはありません。`);
  });
}
