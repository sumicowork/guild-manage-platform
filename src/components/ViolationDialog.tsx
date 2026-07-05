'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface AdminIdentity {
  id: number;
  name: string;
}

interface ViolationReason {
  id: number;
  name: string;
  builtin: boolean;
  notificationTemplate?: string;
}

interface Channel {
  id: string;
  name: string;
  channel_id: string | null;
}

interface ViolationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: 'feed' | 'comment' | 'reply';
  targetId: string;
  targetAuthor?: string;
  targetAuthorId?: string;
  targetFeedId?: string;
}

export function ViolationDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  targetAuthor,
  targetAuthorId,
  targetFeedId,
}: ViolationDialogProps) {
  const { user } = useAuth();
  const [reasons, setReasons] = useState<ViolationReason[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedReasonId, setSelectedReasonId] = useState<string>('');
  const [detail, setDetail] = useState('');
  const [actionType, setActionType] = useState<string>(
    targetType === 'feed' ? 'move' : targetType === 'reply' ? 'delete_reply' : 'delete_comment'
  );
  const [targetChannel, setTargetChannel] = useState<string>('');
  const [muteEnabled, setMuteEnabled] = useState(false);
  const [muteDuration, setMuteDuration] = useState<string>('24h');
  const [customHours, setCustomHours] = useState<string>('');
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyType, setNotifyType] = useState<string>('reply');
  const [notifyContent, setNotifyContent] = useState('');
  const [globalTemplate, setGlobalTemplate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [identities, setIdentities] = useState<AdminIdentity[]>([]);
  const [adminIdentityId, setAdminIdentityId] = useState<string>('');

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open]);

  // Build notification content from global template when reason or mute changes
  useEffect(() => {
    if (!globalTemplate) return;
    const reason = reasons.find((r) => r.id === Number(selectedReasonId));
    if (!reason) return;

    const muteLabelMap: Record<string, string> = {
      '1h': '1小时', '12h': '12小时', '24h': '1天',
      '7d': '7天', '30d': '30天', 'permanent': '永久',
    };
    const muteLabel = muteEnabled
      ? (muteLabelMap[muteDuration] || (customHours || '24') + '小时')
      : '';
    const muteText = muteLabel ? `并对您的账号作【${muteLabel}禁言】处理。` : '';

    const content = globalTemplate
      .replace(/\{违规原因\}/g, reason.name)
      .replace(/\{禁言处理\}/g, muteText);
    setNotifyContent(content);
  }, [selectedReasonId, reasons, globalTemplate, muteEnabled, muteDuration, customHours]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [reasonsData, channelsData, identitiesData, templateData] = await Promise.all([
        api.get<ViolationReason[]>('/violation-reasons'),
        api.get<Channel[]>('/channels'),
        api.get<AdminIdentity[]>('/admin-identities'),
        api.get<{ template: string }>('/app-config/violation-notification-template').catch(() => ({ template: '' })),
      ]);
      setReasons(reasonsData);
      setChannels(channelsData);
      setGlobalTemplate(templateData.template || '');

      // Operator: only show own identity (matched by nickname === username)
      let filteredIdentities = identitiesData;
      if (user?.role !== 'admin') {
        filteredIdentities = identitiesData.filter(
          (id) => id.name === user?.username
        );
      }
      setIdentities(filteredIdentities);
      // Auto-select first (only) identity
      if (filteredIdentities.length > 0 && !adminIdentityId) {
        setAdminIdentityId(String(filteredIdentities[0].id));
      }
    } catch {
      toast.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedReasonId) {
      toast.error('请选择违规原因');
      return;
    }
    if (!adminIdentityId) {
      toast.error('请选择操作身份');
      return;
    }
    if (actionType === 'move' && !targetChannel) {
      toast.error('请选择目标版块');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/violations', {
        targetType,
        targetId,
        reasonId: Number(selectedReasonId),
        detail: detail || undefined,
        actionType,
        targetChannel: actionType === 'move' ? targetChannel : undefined,
        mute: muteEnabled ? { duration: muteDuration === 'custom' ? (customHours || '24') : muteDuration } : undefined,
        notification: notifyEnabled
          ? { type: notifyType, content: notifyContent }
          : undefined,
        targetAuthorId,
        targetFeedId: targetFeedId || (targetType === 'feed' ? targetId : undefined),
        adminIdentityId: adminIdentityId ? Number(adminIdentityId) : undefined,
      });
      toast.success('违规处置已提交');
      onOpenChange(false);
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSelectedReasonId('');
    setDetail('');
    setActionType(targetType === 'feed' ? 'move' : targetType === 'reply' ? 'delete_reply' : 'delete_comment');
    setTargetChannel('');
    setMuteEnabled(false);
    setMuteDuration('24h');
    setCustomHours('');
    setNotifyEnabled(true);
    setNotifyType('reply');
    setNotifyContent('');
  };

  const actionOptions =
    targetType === 'feed'
      ? [
          { value: 'move', label: '移帖' },
          { value: 'delete', label: '删帖' },
        ]
      : targetType === 'reply'
      ? [{ value: 'delete_reply', label: '删评论' }]
      : [{ value: 'delete_comment', label: '删评论' }];

  const targetLabel = targetType === 'feed' ? '帖子' : '评论';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>标记违规</DialogTitle>
          <DialogDescription>
            {targetLabel} {targetId}
            {targetAuthor && ` · ${targetAuthor}`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Admin identity */}
            <div className="space-y-2">
              <Label>
                操作身份 <span className="text-red-500">*</span>
              </Label>
              <Select value={adminIdentityId} onValueChange={(v) => setAdminIdentityId(v ?? '')}>
                <SelectTrigger className={`w-full ${!adminIdentityId && identities.length > 0 ? 'border-red-400' : ''}`}>
                  <span className="text-sm">{adminIdentityId ? (identities.find(i => String(i.id) === adminIdentityId)?.name || '选择管理员身份') : '选择管理员身份（必选）'}</span>
                </SelectTrigger>
                <SelectContent>
                  {identities.length === 0 ? (
                    <SelectItem value="" disabled>
                      暂无可用的管理员身份
                    </SelectItem>
                  ) : (
                    identities.map((id) => (
                      <SelectItem key={id.id} value={String(id.id)}>
                        {id.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {identities.length === 0 && (
                <p className="text-xs text-amber-500">系统中没有管理员凭证，请先在设置中添加</p>
              )}
            </div>

            {/* Violation reason */}
            <div className="space-y-2">
              <Label>违规原因 *</Label>
              <Select value={selectedReasonId} onValueChange={(v) => setSelectedReasonId(v ?? '')}>
                <SelectTrigger className="w-full">
                  <span className="text-sm">{selectedReasonId ? (reasons.find(r => String(r.id) === selectedReasonId)?.name || '选择违规原因') : '选择违规原因'}</span>
                </SelectTrigger>
                <SelectContent>
                  {reasons.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Detail */}
            <div className="space-y-2">
              <Label>补充说明</Label>
              <Textarea
                placeholder="可选的详细说明..."
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={2}
              />
            </div>

            {/* Action type */}
            <div className="space-y-2">
              <Label>处置方式</Label>
              <div className="flex gap-2">
                {actionOptions.map((opt) => (
                  <Button
                    key={opt.value}
                    variant={actionType === opt.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActionType(opt.value)}
                    type="button"
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Target channel for move */}
            {actionType === 'move' && (
              <div className="space-y-2">
                <Label>目标版块</Label>
                <Select value={targetChannel} onValueChange={(v) => setTargetChannel(v ?? '')}>
                  <SelectTrigger className="w-full">
                    <span className="text-sm">{targetChannel ? (channels.find(c => c.channel_id === targetChannel)?.name || '选择目标版块') : '选择目标版块'}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {channels.filter(c => c.channel_id).map((ch) => (
                      <SelectItem key={ch.id} value={ch.channel_id!}>
                        {ch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Mute */}
            <div className="flex items-center justify-between">
              <Label>禁言</Label>
              <Switch checked={muteEnabled} onCheckedChange={setMuteEnabled} />
            </div>
            {muteEnabled && (
              <div className="space-y-2">
                <Label>禁言时长</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { value: '1h', label: '1小时' },
                    { value: '12h', label: '12小时' },
                    { value: '24h', label: '1天' },
                    { value: '7d', label: '7天' },
                    { value: '30d', label: '30天' },
                    { value: 'permanent', label: '永久' },
                  ].map((opt) => (
                    <Button
                      key={opt.value}
                      variant={muteDuration === opt.value ? 'default' : 'outline'}
                      size="sm"
                      className="text-xs"
                      onClick={() => setMuteDuration(opt.value)}
                      type="button"
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant={muteDuration === 'custom' ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs shrink-0"
                    onClick={() => setMuteDuration('custom')}
                    type="button"
                  >
                    自定义
                  </Button>
                  {muteDuration === 'custom' && (
                    <Input
                      type="number"
                      min={1}
                      placeholder="输入小时数"
                      value={customHours}
                      onChange={(e) => setCustomHours(e.target.value)}
                      className="w-28 h-8 text-xs"
                    />
                  )}
                  {muteDuration === 'custom' && (
                    <span className="text-xs text-gray-400">小时</span>
                  )}
                </div>
              </div>
            )}

            {/* Notification */}
            <div className="flex items-center justify-between">
              <Label>通知用户</Label>
              <Switch checked={notifyEnabled} onCheckedChange={setNotifyEnabled} />
            </div>
            {notifyEnabled && (
              <>
                <div className="space-y-2">
                  <Label>通知方式</Label>
                  <div className="flex gap-2">
                    <Button
                      variant={notifyType === 'reply' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setNotifyType('reply')}
                      type="button"
                    >
                      评论
                    </Button>
                    <Button
                      variant={notifyType === 'dm' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setNotifyType('dm')}
                      type="button"
                    >
                      私信
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>通知内容</Label>
                  <Textarea
                    value={notifyContent}
                    onChange={(e) => setNotifyContent(e.target.value)}
                    rows={3}
                    placeholder="支持变量: {用户昵称}, {帖子标题}, {帖子链接}, {违规原因}"
                  />
                  <p className="text-xs text-gray-400">
                    支持变量: {'{用户昵称}'}, {'{帖子标题}'}, {'{帖子链接}'}, {'{违规原因}'}
                  </p>
                </div>
              </>
            )}

          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} type="button">
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || loading} type="button">
            {submitting && <Loader2 className="animate-spin" />}
            {submitting ? '提交中...' : '确认处置'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
