// A client for the Switch agent protocol: one WebSocket for events, HTTP for operations.
// https://docs.switchagents.ai/switch-rooms/internals/agent-connection

export type RoomMessage = {
  roomId: string;
  messageId: string;
  sender: string;
  senderName: string;
  addressed: boolean;
  body: string;
  timestamp: number;
  threadId: string | null;
};

export type AgentOptions = {
  apiUrl: string;
  name: string;
  id: string;
  apiKey: string;
  connectionId: string;
  roomId?: string;
  filter?: 'all' | 'addressed';
  onMessage?: (message: RoomMessage) => void | Promise<void>;
  onStatus?: (connected: boolean) => void;
  log?: (line: string) => void;
};

type Frame = {
  event?: string;
  type?: string;
  id?: number;
  data?: Record<string, any>;
  code?: string;
};

const RECONNECT_MS = 1000;
const ABNORMAL_CLOSE = 1006;
const SEEN_LIMIT = 500;

export class SwitchAgent {
  readonly name: string;
  connected = false;

  private socket: WebSocket | null = null;
  private cursor: number | null = null;
  private generation: number | null = null;
  private stopped = false;
  private seen = new Set<string>();
  private ready: (() => void) | null = null;

  constructor(private readonly options: AgentOptions) {
    this.name = options.name;
  }

  /** Opens the socket and resolves once the agent is connected to its room. */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.ready = resolve;
      this.open();
    });
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
  }

  async op<T = any>(operation: string, args: Record<string, unknown> = {}): Promise<T> {
    const { apiUrl, id, apiKey, connectionId } = this.options;
    const response = await fetch(`${apiUrl}/agents/${id}/ops/${operation}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Switch-Connection-Id': connectionId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${this.name} ${operation} failed: ${response.status} ${text.slice(0, 300)}`);
    }
    return (JSON.parse(text) as { result: T }).result;
  }

  /** Posts to the room, or into a thread. Returns the new message's id. */
  async post(body: string, threadId?: string | null): Promise<string> {
    const result = await this.op<{ event_id: string }>('post_message', {
      body,
      thread_id: threadId ?? null,
    });
    return result.event_id;
  }

  /** Sends an addressed message, logs any target that isn't connected, and returns its id. */
  async send(body: string, targets: string[], threadId?: string | null): Promise<string> {
    const result = await this.op<{
      event_id: string;
      target_statuses?: Record<string, string>;
    }>('send_targeted_message', { body, target_names: targets, thread_id: threadId ?? null });
    for (const [target, status] of Object.entries(result.target_statuses ?? {})) {
      if (status !== 'live') this.log(`${target} is ${status}`);
    }
    return result.event_id;
  }

  private log(line: string): void {
    this.options.log?.(`[${this.name}] ${line}`);
  }

  private open(): void {
    const { apiUrl, id, apiKey, connectionId, roomId, filter = 'addressed' } = this.options;
    const query = new URLSearchParams({ connection_id: connectionId, filter });
    if (roomId) query.set('rooms', roomId);
    if (this.cursor !== null) query.set('start_from', String(this.cursor));
    if (this.generation !== null) query.set('expected_generation', String(this.generation));

    const url = `${apiUrl.replace(/^http/, 'ws')}/agents/${id}/connection/ws?${query}`;
    // Node's WebSocket accepts headers; the DOM type doesn't describe them.
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } } as never);
    this.socket = socket;

    // A failed connect can fire error with no close, so either one counts as
    // the drop, once per socket.
    const dropped = (code: number) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.onClose(code);
    };

    socket.addEventListener('message', (event) => this.onFrame(JSON.parse(String(event.data))));
    socket.addEventListener('close', (event) => dropped(event.code));
    socket.addEventListener('error', () => dropped(ABNORMAL_CLOSE));
  }

  private onFrame(frame: Frame): void {
    const kind = frame.event ?? frame.type;

    // Pongs go first: a connection that misses them for 6 seconds lapses.
    if (kind === 'ping') {
      this.socket?.send(JSON.stringify({ type: 'pong', cursor: this.cursor ?? 0 }));
      return;
    }

    if (typeof frame.id === 'number') {
      this.cursor = Math.max(this.cursor ?? 0, frame.id);
    }

    if (kind === 'connection_state') {
      const state = frame.data ?? (frame as Record<string, any>);
      this.generation = state.generation ?? null;
      this.cursor = Math.max(this.cursor ?? 0, state.cursor ?? 0);
      void this.onOpen();
    } else if (kind === 'evicted') {
      const code = frame.data?.code ?? frame.code;
      this.log(`evicted: ${code}`);
      if (code === 'taken_over') this.stopped = true;
    } else if (kind === 'message' && frame.data) {
      this.onRoomMessage(frame.data);
    }
  }

  private async onOpen(): Promise<void> {
    const { roomId, onStatus } = this.options;
    try {
      if (roomId) await this.op('connect_to_room', { room_id: roomId });
      this.connected = true;
      onStatus?.(true);
      this.ready?.();
      this.ready = null;
    } catch (error) {
      this.log(`could not connect to the room: ${(error as Error).message}`);
    }
  }

  private onRoomMessage(data: Record<string, any>): void {
    const payload = data.payload ?? {};
    const messageId = String(payload.message_id ?? '');
    if (!messageId || this.seen.has(messageId)) return;

    this.seen.add(messageId);
    if (this.seen.size > SEEN_LIMIT) {
      const oldest = this.seen.values().next().value;
      if (oldest) this.seen.delete(oldest);
    }

    const message: RoomMessage = {
      roomId: String(data.room_id ?? ''),
      messageId,
      sender: String(payload.sender ?? ''),
      senderName: String(payload.sender_name ?? ''),
      addressed: Boolean(payload.addressed),
      body: String(payload.body ?? ''),
      timestamp: Number(payload.timestamp ?? Date.now()),
      threadId: payload.thread_id ?? null,
    };

    Promise.resolve(this.options.onMessage?.(message)).catch((error: Error) =>
      this.log(`message handler failed: ${error.message}`),
    );
  }

  private onClose(code: number): void {
    if (this.connected) this.log(`socket closed with ${code}, reconnecting`);
    this.connected = false;
    this.options.onStatus?.(false);
    if (this.stopped) return;
    if (code === 4401 || code === 4403) {
      this.log(`socket refused with ${code}. Run pnpm bootstrap and check the keys.`);
      return;
    }
    // A stale generation is refused too, so the next open starts clean.
    if (code === 4409) this.generation = null;
    setTimeout(() => this.open(), RECONNECT_MS);
  }
}
