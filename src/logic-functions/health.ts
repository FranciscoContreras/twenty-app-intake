import { defineLogicFunction } from 'twenty-sdk/define';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { IDS } from '../constants/universal-identifiers';

const handler = async () => {
  try {
    const client = new CoreApiClient();
    await client.query({ intakeSources: { edges: { node: { id: true } } } });
    return { statusCode: 200, body: { status: 'ok', timestamp: new Date().toISOString() } };
  } catch (e) {
    return { statusCode: 503, body: { status: 'error', message: String(e) } };
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.HEALTH_LOGIC_FUNCTION,
  name: 'intake-health',
  description: 'Health check for the Intake app.',
  timeoutSeconds: 5,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/health',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
