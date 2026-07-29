import { useEffect, useState } from 'react';
import { Button, Input, Table } from '@cloudflare/kumo';
import { useApp } from '../app-context';
import { userApi } from '../api';
import type { User } from '../types';
import { Loading } from '../components/common';
import { Modal } from '../components/Modal';

export function AdminUsers() {
  const { toast, refreshPending, refreshView } = useApp();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<{ id: number; max: number } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setUsers(await userApi.list());
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

  const saveCreate = async (u: { username: string; displayName: string; password: string; maxClaims: number }) => {
    try {
      await userApi.create(u);
      toast('成员已创建');
      setCreateOpen(false);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : '创建失败');
    }
  };

  const saveMax = async (id: number, maxClaims: number) => {
    try {
      await userApi.update(id, { maxClaims });
      toast('已更新');
      setEdit(null);
      load();
      refreshPending();
    } catch (e) {
      toast(e instanceof Error ? e.message : '更新失败');
    }
  };

  if (loading) return <Loading />;

  return (
    <div>
      <div className="toolbar">
        <h3 style={{ margin: 0 }}>成员管理</h3>
        <div className="spacer" />
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          ＋ 新建成员
        </Button>
      </div>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.Head>昵称</Table.Head>
            <Table.Head>用户名</Table.Head>
            <Table.Head>角色</Table.Head>
            <Table.Head>接单上限</Table.Head>
            <Table.Head>操作</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {users.map((u) => (
            <Table.Row key={u.id}>
              <Table.Cell>{u.displayName}</Table.Cell>
              <Table.Cell>{u.username}</Table.Cell>
              <Table.Cell>{u.role === 'admin' ? '管理员' : '成员'}</Table.Cell>
              <Table.Cell>{u.maxClaims}</Table.Cell>
              <Table.Cell>
                {u.role === 'member' ? (
                  <Button size="sm" onClick={() => setEdit({ id: u.id, max: u.maxClaims })}>
                    改上限
                  </Button>
                ) : (
                  '—'
                )}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>

      {createOpen && (
        <CreateUserModal onClose={() => setCreateOpen(false)} onSubmit={saveCreate} />
      )}
      {edit && (
        <EditMaxModal
          init={edit.max}
          onClose={() => setEdit(null)}
          onSubmit={(v) => saveMax(edit.id, v)}
        />
      )}
    </div>
  );
}

function CreateUserModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (u: { username: string; displayName: string; password: string; maxClaims: number }) => void;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [maxClaims, setMaxClaims] = useState('10');
  return (
    <Modal title="新建成员" onClose={onClose}>
      <div className="field">
        <label>用户名</label>
        <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名" />
      </div>
      <div className="field">
        <label>昵称</label>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="昵称" />
      </div>
      <div className="field">
        <label>密码</label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
      </div>
      <div className="field">
        <label>接单上限</label>
        <Input type="number" value={maxClaims} onChange={(e) => setMaxClaims(e.target.value)} />
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          onClick={() =>
            onSubmit({
              username,
              displayName,
              password,
              maxClaims: Math.max(1, parseInt(maxClaims, 10) || 10),
            })
          }
        >
          创建
        </Button>
      </div>
    </Modal>
  );
}

function EditMaxModal({
  init,
  onClose,
  onSubmit,
}: {
  init: number;
  onClose: () => void;
  onSubmit: (v: number) => void;
}) {
  const [v, setV] = useState(String(init));
  return (
    <Modal title="设置接单上限" onClose={onClose}>
      <div className="field">
        <label>接单上限（同时进行的选题数）</label>
        <Input type="number" value={v} onChange={(e) => setV(e.target.value)} />
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" onClick={() => onSubmit(Math.max(1, parseInt(v, 10) || init))}>
          保存
        </Button>
      </div>
    </Modal>
  );
}
