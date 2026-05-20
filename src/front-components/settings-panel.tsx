import { defineFrontComponent } from 'twenty-sdk/define';
import React, { useEffect, useRef, useState } from 'react';

const SETTINGS = [
  {
    key: 'INTAKE_APP_LABEL',
    label: 'App Label',
    defaultValue: 'Intake',
    description:
      'The name used in generated content — note titles, opportunity names, and system messages. Change to match your team\'s terminology, e.g. "Leads", "Inbound", "Pipeline".',
  },
  {
    key: 'INTAKE_DEFAULT_OPP_STAGE',
    label: 'Default Opportunity Stage',
    defaultValue: 'NEW',
    description:
      'Stage assigned to automatically created Opportunities. Must match an existing stage value in your workspace (e.g. NEW, SCREENING, MEETING, PROPOSAL, CUSTOMER).',
  },
  {
    key: 'INTAKE_FIELD_CREATION_ENABLED',
    label: 'Auto-create Custom Fields',
    defaultValue: 'true',
    description:
      'When true, Intake automatically creates custom ext fields on Person and Company records when it encounters unknown payload keys. Set to false to route all unknown fields to the note instead.',
  },
  {
    key: 'INTAKE_MAX_EXT_FIELDS',
    label: 'Max Custom Fields Per Object',
    defaultValue: '50',
    description:
      'Maximum number of ext fields allowed per object. Once the limit is reached, any additional unknown fields from that object go to the overflow note instead of extending the schema.',
  },
  {
    key: 'INTAKE_DEDUP_WINDOW_MINUTES',
    label: 'Deduplication Window (minutes)',
    defaultValue: '5',
    description:
      'Payloads with identical content received within this window are treated as duplicates and skipped. Set to 0 to disable deduplication and accept every request.',
  },
  {
    key: 'INTAKE_REQUIRE_HMAC',
    label: 'Require Signed Webhooks',
    defaultValue: 'false',
    description:
      'When true, every Intake Source must have a webhook secret and all requests must be signed with HMAC-SHA256. Unsigned or incorrectly signed requests are rejected with 401 regardless of source config.',
  },
] as const;

type SettingKey = (typeof SETTINGS)[number]['key'];

const InfoIcon: React.FC<{ description: string }> = ({ description }) => {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={ref}>
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: '1.5px solid #9ca3af',
          background: 'transparent',
          color: '#6b7280',
          fontSize: 10,
          fontWeight: 700,
          cursor: 'default',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          lineHeight: 1,
          flexShrink: 0,
        }}
        aria-label="More information"
      >
        i
      </button>
      {visible && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1f2937',
          color: '#f9fafb',
          borderRadius: 6,
          padding: '8px 11px',
          fontSize: 12,
          lineHeight: 1.5,
          width: 260,
          zIndex: 9999,
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {description}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid #1f2937',
          }} />
        </div>
      )}
    </div>
  );
};

const SettingsPanel: React.FC = () => {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(SETTINGS.map(s => [s.key, s.defaultValue])),
  );
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    const apiUrl = (window as any).__TWENTY_API_URL__ ?? '';
    const token = (window as any).__TWENTY_API_TOKEN__ ?? '';
    if (!apiUrl || !token) return;

    fetch(`${apiUrl}/graphql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `{ appTokens { edges { node { name } } } currentWorkspace { id } }` }),
    })
      .then(r => r.json())
      .then(d => {
        // Try to get current values from app variables endpoint
        return fetch(`${apiUrl}/graphql`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `{ applications(filter: { name: { eq: "twenty-app-intake" } }) { edges { node { id applicationVariables } } } }`,
          }),
        });
      })
      .then(r => r.json())
      .then(d => {
        const vars = d?.data?.applications?.edges?.[0]?.node?.applicationVariables ?? {};
        if (typeof vars === 'object') {
          setValues(prev => ({ ...prev, ...Object.fromEntries(
            Object.entries(vars).filter(([k]) => prev[k] !== undefined).map(([k, v]) => [k, String(v)])
          )}));
        }
      })
      .catch(() => { /* use defaults */ });
  }, []);

  const save = async () => {
    setStatus('saving');
    const apiUrl = (window as any).__TWENTY_API_URL__ ?? '';
    const token = (window as any).__TWENTY_API_TOKEN__ ?? '';
    try {
      const app = await fetch(`${apiUrl}/graphql`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{ applications(filter: { name: { eq: "twenty-app-intake" } }) { edges { node { id } } } }`,
        }),
      }).then(r => r.json());

      const appId = app?.data?.applications?.edges?.[0]?.node?.id;
      if (!appId) throw new Error('App not found');

      await fetch(`${apiUrl}/graphql`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation UpdateApp($id: ID!, $data: ApplicationUpdateInput!) { updateApplication(id: $id, data: $data) { id } }`,
          variables: { id: appId, data: { applicationVariables: values } },
        }),
      });

      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  return (
    <div style={{ padding: '24px 28px', fontFamily: 'system-ui, sans-serif', maxWidth: 540 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600 }}>Configuration</h3>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: '#6b7280' }}>
        Set your application configuration variables. Hover the <strong>i</strong> icon for details.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {SETTINGS.map(s => (
          <div key={s.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', letterSpacing: '0.03em', textTransform: 'uppercase' }}>
                {s.label}
              </label>
              <InfoIcon description={s.description} />
            </div>
            <input
              value={values[s.key] ?? s.defaultValue}
              onChange={e => setValues(prev => ({ ...prev, [s.key]: e.target.value }))}
              style={{
                width: '100%',
                padding: '7px 10px',
                fontSize: 13,
                border: '1px solid #d1d5db',
                borderRadius: 6,
                outline: 'none',
                background: '#fff',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
              onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)'; }}
              onBlur={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.boxShadow = 'none'; }}
            />
            <div style={{ marginTop: 3, fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>{s.key}</div>
          </div>
        ))}
      </div>

      <button
        onClick={save}
        disabled={status === 'saving'}
        style={{
          marginTop: 24,
          padding: '8px 20px',
          background: status === 'saved' ? '#22c55e' : status === 'error' ? '#ef4444' : '#111827',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
          cursor: status === 'saving' ? 'wait' : 'pointer',
          transition: 'background 0.2s',
        }}
      >
        {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : status === 'error' ? 'Save failed' : 'Save settings'}
      </button>
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: '4e4cfb3b-508c-413b-a1b2-192a51c31ed4',
  name: 'intake-settings-panel',
  description: 'Custom settings panel with inline documentation for all Intake configuration variables.',
  component: SettingsPanel,
});
