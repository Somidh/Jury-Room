// Posts as the person, through Mattermost, so a message from the web reaches the
// room by the same route as one typed in chat. https://api.mattermost.com

type Config = { url: string; token: string; channelName: string };

export function createHuman({ url, token, channelName }: Config) {
  let channelId: string | null = null;

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${url}/api/v4${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`Mattermost ${path}: ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
  }

  async function channel(): Promise<string> {
    if (channelId) return channelId;
    const teams = await call<{ id: string }[]>('/users/me/teams');
    const found = await call<{ id: string }>(`/teams/${teams[0]!.id}/channels/name/${channelName}`);
    channelId = found.id;
    return channelId;
  }

  return {
    /** Joins the room's channel. A public channel lets you add yourself. */
    async join(): Promise<void> {
      const me = await call<{ id: string }>('/users/me');
      await call(`/channels/${await channel()}/members`, {
        method: 'POST',
        body: JSON.stringify({ user_id: me.id }),
      });
    },

    async say(message: string): Promise<void> {
      await call('/posts', {
        method: 'POST',
        body: JSON.stringify({ channel_id: await channel(), message }),
      });
    },
  };
}
