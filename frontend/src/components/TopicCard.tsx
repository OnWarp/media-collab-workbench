import { Button } from '@cloudflare/kumo';
import type { Topic } from '../types';
import { FavStar, PriceTag, SettleTag, StageBar, StatusTag, fmtTime } from './common';
import { useApp } from '../app-context';
import { topicApi } from '../api';

export function TopicCard({ t, onClick }: { t: Topic; onClick: () => void }) {
  const { me } = useApp();
  const faved = (t.favoritedBy || []).includes(me?.id ?? -1);
  return (
    <div
      className="card clickable"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.fav-btn')) return;
        onClick();
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <h3>{t.title}</h3>
        <FavStar on={faved} />
      </div>
      <StageBar t={t} />
      <p className="intro">{t.intro || '（无简介）'}</p>
      {t.series && t.series.length > 0 && (
        <div className="series-tags">
          {t.series.map((s) => (
            <span className="series-tag" key={s}>
              #{s}
            </span>
          ))}
        </div>
      )}
      <div className="meta">
        <StatusTag t={t} />
        <PriceTag t={t} />
        <SettleTag t={t} />
        {t.overdue && <span className="tag overdue">⏰ 已超时</span>}
      </div>
      <div className="row">
        <span className="meta">认领人：<b>{t.claimerName || '—'}</b></span>
        <span className="meta">💬{t.commentCount} · 📎{t.materialCount}</span>
        <span className="meta">📥在库 {t.daysInLibrary} 天</span>
        <span className="meta">🕒{t.createdAtLabel || ''}</span>
      </div>
    </div>
  );
}

export function ReviewCard({ t, onOpen }: { t: Topic; onOpen: () => void }) {
  const stageName = t.reviewStage === 'video' ? '视频' : '文案';
  return (
    <div className="card clickable" onClick={onOpen}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <h3>{t.title}</h3>
        <span className="tag review">{stageName}待审</span>
      </div>
      <StageBar t={t} />
      <p className="intro">{t.intro || '（无简介）'}</p>
      <div className="meta">
        <StatusTag t={t} />
        <PriceTag t={t} />
      </div>
      <div className="row">
        <span className="meta">发布者：{t.authorName}</span>
        <span className="meta">认领人：{t.claimerName || '—'}</span>
      </div>
      <div className="actions">
        <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          审核（看文案/视频）
        </Button>
      </div>
    </div>
  );
}

export function RecycleCard({
  t,
  onOpen,
  onRestore,
  onPurge,
}: {
  t: Topic;
  onOpen: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const { me } = useApp();
  const reasonTxt = t.recycledReason === 'delete' ? '删除' : '废弃';
  const days = t.recycleDaysLeft ?? 0;
  return (
    <div className="card recycle-card" onClick={onOpen}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <h3>{t.title}</h3>
        <span className="tag recycled">🗑️ 回收站</span>
      </div>
      <div className="meta">
        <span className="tag">
          {reasonTxt}于 {fmtTime(t.recycledAt)}
        </span>
        <span className={'tag ' + (days <= 5 ? 'overdue' : 'review')}>
          {days} 天后清除
        </span>
      </div>
      <p className="intro">{t.intro || '（无简介）'}</p>
      <div className="row">
        <span className="meta">发布者：<b>{t.authorName || '—'}</b></span>
      </div>
      <div className="recycle-actions">
        <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onRestore(); }}>
          恢复选题
        </Button>
        {me?.role === 'admin' && (
          <Button variant="destructive" size="sm" onClick={(e) => { e.stopPropagation(); onPurge(); }}>
            永久删除
          </Button>
        )}
      </div>
    </div>
  );
}

export async function toggleFav(t: Topic) {
  const r = await topicApi.favorite(t.id);
  return r.favorited;
}
