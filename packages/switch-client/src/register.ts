export type AgentDefinition = {
  name: string;
  displayName: string;
  description: string;
};

export type AgentCredentials = { id: string; apiKey: string };

/** Registers an always-on agent. Needs a registration key from the Gateway. */
export async function registerAgent(
  apiUrl: string,
  registrationKey: string,
  agent: AgentDefinition,
): Promise<AgentCredentials> {
  const response = await fetch(`${apiUrl}/agents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${registrationKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: agent.name,
      display_name: agent.displayName,
      description: agent.description,
      connector_type: 'jury-room',
      integration_profile: {
        connection_model: 'always_on',
        message_exchange: true,
        pre_invocation_mediation: [],
        post_invocation_mediation: [],
        event_reporting: [],
      },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Registering ${agent.name} failed: ${response.status} ${text.slice(0, 300)}`);
  }
  const { id, api_key: apiKey } = JSON.parse(text) as { id: string; api_key: string };
  return { id, apiKey };
}
