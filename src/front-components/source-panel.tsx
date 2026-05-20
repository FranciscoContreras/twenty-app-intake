import { defineFrontComponent } from 'twenty-sdk/define';
import React, { useEffect, useState } from 'react';

type SourceData = {
  id: string;
  name: string;
  slug: string;
  status: string;
  targetObject: string;
  webhookSecret: string | null;
  totalIngested: number;
  lastIngestedAt: string | null;
  createOpportunity: boolean;
  opportunityNameTemplate: string;
};

const copyIcon = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

const SourcePanel: React.FC<{ recordId?: string }> = ({ recordId }) => {
  const [source, setSource] = useState<SourceData | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!recordId) { setLoading(false); return; }
    const apiUrl = (window as any).__TWENTY_API_URL__ ?? '';
    const token = (window as any).__TWENTY_API_TOKEN__ ?? '';

    fetch(`${apiUrl}/rest/intakeSources/${recordId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => setSource(d.data?.intakeSource ?? null))
      .finally(() => setLoading(false));
  }, [recordId]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const webhookUrl = source
    ? `${(window as any).__TWENTY_API_URL__ ?? 'https://your-crm.com'}/s/intake/${source.slug}`
    : '';

  if (loading) return <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>Loading...</div>;
  if (!source) return <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>Source not found.</div>;

  const Code: React.FC<{ value: string; copyKey: string }> = ({ value, copyKey }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px' }}>
      <code style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all', color: '#111' }}>{value}</code>
      <button
        onClick={() => copy(value, copyKey)}
        style={{ border: 'none', background: 'none', cursor: 'pointer', color: copied === copyKey ? '#22c55e' : '#6b7280', padding: 2, flexShrink: 0 }}
        title="Copy"
        dangerouslySetInnerHTML={{ __html: copied === copyKey ? '✓' : copyIcon }}
      />
    </div>
  );

  return (
    <div style={{ padding: '16px 20px', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{
          background: source.status === 'ACTIVE' ? '#dcfce7' : '#fef3c7',
          color: source.status === 'ACTIVE' ? '#16a34a' : '#d97706',
          borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600,
        }}>{source.status}</span>
        <span style={{ color: '#6b7280' }}>→ {source.targetObject}</span>
        <span style={{ marginLeft: 'auto', color: '#6b7280' }}>
          {source.totalIngested} ingested
          {source.lastIngestedAt && ` · last ${new Date(source.lastIngestedAt).toLocaleDateString()}`}
        </span>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 500, marginBottom: 5, color: '#374151' }}>Webhook URL</div>
        <Code value={webhookUrl} copyKey="url" />
        <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af' }}>POST this URL from your platform to ingest leads.</div>
      </div>

      {source.webhookSecret && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 500, marginBottom: 5, color: '#374151' }}>Signing Secret</div>
          <Code value={source.webhookSecret} copyKey="secret" />
          <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af' }}>HMAC-SHA256 sign requests with this secret. Header: <code>X-Webhook-Signature: sha256=&lt;digest&gt;</code></div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 500, marginBottom: 5, color: '#374151' }}>Dry-run URL</div>
        <Code value={`${webhookUrl}/test`} copyKey="test" />
        <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af' }}>Test any payload without writing to the CRM.</div>
      </div>

      <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 12, marginTop: 4 }}>
        <div style={{ fontWeight: 500, marginBottom: 8, color: '#374151' }}>Quick send</div>
        <pre style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 12px', fontSize: 11, overflow: 'auto', color: '#374151', margin: 0 }}>{`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"first_name":"Jane","email":"jane@co.com","company":"Acme"}'`}</pre>
      </div>
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: 'c9d2e8f3-1b4a-4c7d-9e5f-6a7b8c0d1e2f',
  name: 'intake-source-panel',
  description: 'Shows the webhook URL, signing secret, and quick-send snippet for an Intake Source.',
  component: SourcePanel,
});
