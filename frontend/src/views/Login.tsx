import { useState } from 'react';
import { Button, Input, Tabs } from '@cloudflare/kumo';
import { useApp } from '../app-context';
import { authApi } from '../api';

export function Login() {
  const { setMe, navigate, toast, openModal } = useApp();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (tab === 'login') {
        const r = await authApi.login(username, password);
        setMe(r.user);
        toast('登录成功');
        if (r.user.showTutorial) openModal({ type: 'tutorial' });
        else navigate('board');
      } else {
        const r = await authApi.register(username, password, displayName);
        setMe(r.user);
        toast('注册成功');
        openModal({ type: 'tutorial' });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand">
          <div className="logo">媒</div>
          <h1>自媒体内容协作工作台</h1>
          <p>选题进度跟踪 · 作品验收结算一体化后台</p>
        </div>
        <Tabs
          variant="segmented"
          tabs={[
            { value: 'login', label: '登录' },
            { value: 'register', label: '注册成员' },
          ]}
          selectedValue={tab}
          onValueChange={(v) => setTab(v as 'login' | 'register')}
        />
        <form className="login-form" onSubmit={submit}>
          <Input
            label="用户名"
            placeholder="用户名"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          {tab === 'register' && (
            <Input
              label="昵称（可选）"
              placeholder="昵称"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
          <Input
            label="密码"
            type="password"
            placeholder="密码"
            autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" variant="primary" loading={busy}>
            {tab === 'login' ? '登 录' : '注 册'}
          </Button>
          {tab === 'register' && (
            <div className="hint">
              注册后身份为「普通成员」，可发布/认领选题、提交作品
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
