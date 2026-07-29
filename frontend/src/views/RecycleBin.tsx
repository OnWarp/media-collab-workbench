import { useEffect, useState } from 'react';
import { useApp } from '../app-context';
import { topicApi } from '../api';
import type { Topic } from '../types';
import { Loading } from '../components/common';
import { RecycleCard } from '../components/TopicCard';

export function RecycleBin() {
  const { openModal, toast, refreshView, refreshPending } = useApp();
  const [list, setList] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setList(await topicApi.list({ recycled: true }));
    } catch (e) {
      toast(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshView]);

  const restore = async (id: number) => {
    if (!window.confirm('确定恢复该选题？将回到原状态并移出回收站。')) return;
    try {
      await topicApi.restore(id);
      toast('已恢复');
      load();
      refreshPending();
    } catch (e) {
      toast(e instanceof Error ? e.message : '恢复失败');
    }
  };

  const purge = async (id: number) => {
    if (!window.confirm('永久删除后无法恢复，确定？')) return;
    try {
      await topicApi.purge(id);
      toast('已永久删除');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败');
    }
  };

  if (loading) return <Loading />;

  return (
    <div>
      <div className="toolbar">
        <h3 style={{ margin: 0 }}>回收站</h3>
        <div className="spacer" />
        <span className="pill">废弃 / 删除的选题在此保留 30 天，逾期自动永久删除</span>
      </div>
      {list.length ? (
        <div className="grid">
          {list.map((t) => (
            <RecycleCard
              key={t.id}
              t={t}
              onOpen={() => openModal({ type: 'topic', id: t.id })}
              onRestore={() => restore(t.id)}
              onPurge={() => purge(t.id)}
            />
          ))}
        </div>
      ) : (
        <div className="empty">回收站为空</div>
      )}
    </div>
  );
}
