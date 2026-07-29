import { useEffect, useState } from 'react';
import { Button } from '@cloudflare/kumo';
import { useApp } from '../app-context';
import { topicApi } from '../api';
import type { Topic } from '../types';
import { PLATFORMS, PLATFORM_COLORS, PLATFORM_LABELS } from '../api';
import { Loading, PriceTag, StatusTag, fmtTime } from '../components/common';

export function Traffic() {
  const { openModal, me, refreshView, toast } = useApp();
  const [list, setList] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const all = await topicApi.list({ traffic: true });
        setList(all);
      } catch (e) {
        toast(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshView]);

  if (loading) return <Loading />;

  const my = list.filter((t) => t.claimerId === me?.id);
  const others =
    me?.role === 'admin' ? list.filter((t) => t.claimerId !== me?.id) : [];

  if (!list.length) return <div className="empty">暂无需要填报流量的视频</div>;

  const card = (t: Topic) => {
    const canEdit = t.claimerId === me?.id;
    const tot = t.trafficTotals || {};
    return (
      <div className="card tcard">
        <h3>{t.title}</h3>
        <div className="meta">
          <StatusTag t={t} />
          <PriceTag t={t} />
          {t.trafficOverdue ? (
            <span className="tag overdue">⏰ 未填报</span>
          ) : t.trafficFilled ? (
            <span className="tag finished">已填报</span>
          ) : (
            <span className="tag review">待填报</span>
          )}
        </div>
        {t.trafficFilled ? (
          <div className="traffic-data">
            {PLATFORMS.map((p) => (
              <span className="pf-sum" key={p}>
                <i style={{ background: PLATFORM_COLORS[p] }} />
                {PLATFORM_LABELS[p]} ▶{tot[p]?.views ?? 0}
              </span>
            ))}
          </div>
        ) : (
          <div className="traffic-data muted">
            {t.trafficDueAt ? '截止 ' + fmtTime(t.trafficDueAt) : ''}
          </div>
        )}
        {canEdit ? (
          <Button
            variant="primary"
            size="sm"
            style={{ marginTop: 8 }}
            onClick={() => openModal({ type: 'traffic', id: t.id })}
          >
            {t.trafficFilled ? '修改 / 查看' : '填报数据'}
          </Button>
        ) : (
          <div className="meta">认领人：{t.claimerName}</div>
        )}
      </div>
    );
  };

  return (
    <div>
      <p className="hint" style={{ margin: '0 0 16px' }}>
        全流程视频审核通过发布后，请在 <b>7 天</b> 内按 <b>抖音 / 快手 / 小红书</b>{' '}
        三平台填报播放 / 点赞 / 收藏数据（可填多天形成时间线）；逾期未填报会收到提醒。
      </p>
      {others.length > 0 && (
        <>
          <h4 style={{ margin: '0 0 10px' }}>团队成员填报（{others.length}）</h4>
          <div className="grid">{others.map((t) => card(t))}</div>
        </>
      )}
      <h4 style={{ margin: '18px 0 10px' }}>我的视频（{my.length}）</h4>
      {my.length ? (
        <div className="grid">{my.map((t) => card(t))}</div>
      ) : (
        <div className="empty">暂无需要填报的视频</div>
      )}
    </div>
  );
}
