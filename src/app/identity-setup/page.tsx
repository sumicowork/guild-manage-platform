'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, QrCode } from 'lucide-react';

export default function IdentitySetupPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [qrData, setQrData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [message, setMessage] = useState('');

  const startLogin = async () => {
    setLoading(true);
    setQrData(null);
    try {
      const data = await api.post<{ qrcodeBase64: string; message?: string }>('/auth/identity-setup');
      let qrSrc = data.qrcodeBase64;
      if (qrSrc && !qrSrc.startsWith('data:')) {
        qrSrc = `data:image/png;base64,${qrSrc}`;
      }
      setQrData(qrSrc);
      setMessage(data.message || '请使用 QQ 扫描二维码登录');
      // Start polling
      pollCompletion();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '启动登录失败');
    } finally {
      setLoading(false);
    }
  };

  const pollCompletion = async () => {
    setPolling(true);
    try {
      await api.get('/auth/identity-setup');
      toast.success('身份设置成功');
      await refresh(); // update auth context
      router.replace('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('超时')) {
        toast.error('扫码超时，请重新发起');
      } else {
        toast.error(msg || '设置失败');
      }
    } finally {
      setPolling(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">设置频道身份</CardTitle>
          <CardDescription>
            你需要用 QQ 扫码登录，将频道账号与本平台账户绑定后才能使用。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {qrData ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrData}
                alt="QQ 登录二维码"
                className="rounded-lg border border-gray-200"
                style={{ width: 256, height: 256 }}
              />
              <p className="text-sm text-gray-500 text-center">{message}</p>
              {polling && (
                <p className="text-sm text-blue-500 flex items-center gap-2">
                  <Loader2 className="animate-spin size-4" />
                  等待扫码授权...
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 py-8">
              <QrCode className="size-16 text-gray-300" />
              <p className="text-sm text-gray-500">点击下方按钮生成登录二维码</p>
            </div>
          )}
        </CardContent>
        <CardFooter>
          {!qrData ? (
            <Button className="w-full" onClick={startLogin} disabled={loading}>
              {loading && <Loader2 className="animate-spin" />}
              {loading ? '生成中...' : '开始配置'}
            </Button>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              onClick={startLogin}
              disabled={polling}
            >
              重新生成
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
