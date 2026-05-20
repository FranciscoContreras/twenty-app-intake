import { defineFrontComponent } from 'twenty-sdk/define';
import React, { useEffect, useState } from 'react';

type SourceStat = {
  id: string;
  name: string;
  slug: string;
  status: string;
  totalIngested: number;
  lastIngestedAt: string | null;
};

type LogStat = {
  status: string;
  count: number;
};

const Dashboard: React.FC = () => {
  const [sources, setSources] = useState<SourceStat[]>([]);
  const [logStats, setLogStats] = useState<LogStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiUrl = (window as any).__TWENTY_API_URL__ ?? '';
    const token = (window as any).__TWENTY_API_TOKEN__ ?? '';

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const query = (q: string) =>
      fetch(`${apiUrl}/graphql`, { method: 'POST', headers, body: JSON.stringify({ query: q }) })
        .then(r => r.json());

    Promise.all([
      query(`{ intakeSources(first: 20, orderBy: { lastIngestedAt: DescNullsLast }) { edges { node { id name slug status totalIngested lastIngestedAt } } } }`),
      query(`{ intakeLogs(first: 200) { edges { node { status } } } }`),
    ]).then(([srcRes, logRes]) => {
      setSources((srcRes.data?.intakeSources?.edges ?? []).map((e: any) => e.node));
      const counts: Record<string, number> = {};
      for (const e of (logRes.data?.intakeLogs?.edges ?? [])) {
        counts[e.node.status] = (counts[e.node.status] ?? 0) + 1;
      }
      setLogStats(Object.entries(counts).map(([status, count]) => ({ status, count })));
    }).finally(() => setLoading(false));
  }, []);

  const statusColor = (s: string) => s === 'ACTIVE' ? '#22c55e' : '#f59e0b';
  const logColor = (s: string) =>
    s === 'SUCCESS' ? '#22c55e' : s === 'PARTIAL' ? '#f59e0b' : s === 'FAILED' ? '#ef4444' : '#6b7280';

  if (loading) return <div style={{ padding: 24, color: '#6b7280' }}>Loading...</div>;

  const total = logStats.reduce((s, l) => s + l.count, 0);

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 800 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Intake</h2>
      <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>
        {sources.length} source{sources.length !== 1 ? 's' : ''} · {total} total ingestions
      </p>

      {/* Log stats */}
      {logStats.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
          {logStats.map(l => (
            <div key={l.status} style={{
              background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8,
              padding: '10px 16px', minWidth: 100,
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: logColor(l.status) }}>{l.count}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{l.status}</div>
            </div>
          ))}
        </div>
      )}

      {/* Sources table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            {['Source', 'Slug', 'Status', 'Ingested', 'Last Active'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sources.map(s => (
            <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '8px', fontWeight: 500 }}>{s.name}</td>
              <td style={{ padding: '8px', fontFamily: 'monospace', color: '#6b7280', fontSize: 12 }}>{s.slug}</td>
              <td style={{ padding: '8px' }}>
                <span style={{
                  background: s.status === 'ACTIVE' ? '#dcfce7' : '#fef3c7',
                  color: statusColor(s.status), borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 600,
                }}>{s.status}</span>
              </td>
              <td style={{ padding: '8px', textAlign: 'right' }}>{s.totalIngested ?? 0}</td>
              <td style={{ padding: '8px', color: '#6b7280', fontSize: 12 }}>
                {s.lastIngestedAt ? new Date(s.lastIngestedAt).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
          {sources.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
              No sources yet — use the registration endpoint to add one.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: '7a3f8b12-c4d9-4e1a-b2f5-8c6d0e9f1a2b',
  name: 'intake-dashboard',
  description: 'Intake sources and ingestion statistics',
  component: Dashboard,
});
