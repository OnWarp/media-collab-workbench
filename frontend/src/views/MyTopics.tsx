import { useEffect, useState } from 'react';
import { Tabs } from '@cloudflare/kumo';
import { useApp } from '../app-context';
import { topicApi } from '../api';
import type { Topic } from '../types';
import { Loading } from '../components/common';
import { TopicCard } from '../components/TopicCard';

type Tab = 'claim' | 'pub' | 'active' | 'settle';

export function MyTopics() {
  const { openModal, refreshView } = useApp();
  const [tab, setTab] = useState<Tab>('claim');
  const [list, setList] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const all = await topicApi.list({ mine: true });
        if (!active) return;
        let view = all;
        if (tab === 'pub') view = all; // same call; filtered client-side below
        if (tab === 'active')
          view = all.filter((t) => t.status === 'in_progress' || t.status === 'review');
        if (tab === 'settle')
          view = all; // show all with settlement emphasis (filtering done in render)
        const published = tab === 'pub' ? await topicApi.list({ author: true }) : all;
        setList(tab === 'pub' ? published : view);
      } catch {
        /* ignore */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, refreshView]);

  const titleMap: Record<Tab, string> = {
    claim: '我认领的选题',
    pub: '我发布的选题',
    active: '进行中',
    settle: '我的结算',
  };

  let shown = list;
  if (tab === 'settle') {
    const settled = list.filter((t) => t.settlementStatus === 'settled');
    const pend = list.filter((t) => t.status === 'finished' && t.settlementStatus === 'unsettled');
    shown = [...settled, ...pend];
  }

  return (
    <div>
      <Tabs
        variant="segmented"
        tabs={[
          { value: 'claim', label: '我认领的' },
          { value: 'pub', label: '我发布的' },
          { value: 'active', label: '进行中' },
          { value: 'settle', label: '我的结算' },
        ]}
        selectedValue={tab}
        onValueChange={(v) => setTab(v as Tab)}
      />
      <div style={{ marginTop: 16 }}>
        {loading ? (
          <Loading />
        ) : tab === 'settle' ? (
          <>
            <h3 style={{ margin: '14px 0 12px' }}>
              我的结算（已结算 {list.filter((t) => t.settlementStatus === 'settled').length}
              {list.filter((t) => t.status === 'finished' && t.settlementStatus === 'unsettled').length
                ? ' · 待结算 ' + list.filter((t) => t.status === 'finished' && t.settlementStatus === 'unsettled').length
                : ''}
              ）
            </h3>
            {shown.length ? (
              <div className="grid">
                {shown.map((t) => (
                  <TopicCard key={t.id} t={t} onClick={() => openModal({ type: 'topic', id: t.id })} />
                ))}
              </div>
            ) : (
              <div className="empty">暂无结算记录</div>
            )}
          </>
        ) : (
          <>
            <h3 style={{ margin: '14px 0 12px' }}>
              {titleMap[tab]}（{list.length}）
            </h3>
            {list.length ? (
              <div className="grid">
                {list.map((t) => (
                  <TopicCard key={t.id} t={t} onClick={() => openModal({ type: 'topic', id: t.id })} />
                ))}
              </div>
            ) : (
              <div className="empty">
                {tab === 'claim'
                  ? '还没有认领选题，去「选题接单」认领一个吧'
                  : tab === 'pub'
                    ? '还没有发布选题'
                    : '暂无进行中的选题'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
