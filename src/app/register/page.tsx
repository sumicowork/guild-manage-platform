'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, ArrowLeft } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error('请填写所有必填项');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('两次密码不一致');
      return;
    }
    if (password.length < 6) {
      toast.error('密码至少需要 6 个字符');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/register', {
        username: username.trim(),
        password,
      });
      setRegistered(true);
      toast.success('注册申请已提交');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  if (registered) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">注册申请已提交</CardTitle>
            <CardDescription>请等待管理员审批后登录</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" className="w-full" onClick={() => router.push('/login')}>
              <ArrowLeft className="size-4" />
              返回登录
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">注册运营账号</CardTitle>
          <CardDescription>注册后需等待管理员审批</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="reg-username">用户名</Label>
              <Input
                id="reg-username"
                type="text"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reg-password">密码</Label>
              <Input
                id="reg-password"
                type="password"
                placeholder="至少 6 个字符"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reg-confirm">确认密码</Label>
              <Input
                id="reg-confirm"
                type="password"
                placeholder="再次输入密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="animate-spin" />}
              {loading ? '提交中...' : '提交注册申请'}
            </Button>
            <Link href="/login" className="text-sm text-gray-500 hover:text-gray-700">
              已有账号？返回登录
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
