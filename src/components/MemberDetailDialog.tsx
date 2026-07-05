'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { ThumbsUp, MessageCircle, CornerDownRight, AlertTriangle } from 'lucide-react';

interface MemberInfo {
  tinyid: string;
  nickname: string;
  globalNickname?: string;
  role?: string;
  status: string;
  joinedAt?: string;
}

interface MemberStats {
  feedCount: number;
  commentCount: number;
  replyCount: number;
  likeCount: number;
  violationCount: number;
}

interface FeedItem {
  id: string;
  feedId: string;
  title: string;
  content: string;
  createdAt: string;
  status: string;
  likeCount: number;
  commentCount: number;
}

interface CommentItem {
  id: string;
  commentId: string;
  content: string;
  createdAt: string;
  feedId: string;
  feedTitle: string;
  likeCount: number;
}

interface ReplyItem {
  id: string;
  replyId: string;
  content: string;
  createdAt: string;
  feedId: string;
  feedTitle: string;
  commentContent: string;
  targetUser?: string;
}

interface ViolationItem {
  id: number;
  reason: string;
  actionType: string;
  createdAt: string;
}

interface MemberHistoryData {
  member: MemberInfo;
  stats: MemberStats;
  feeds: FeedItem[];
  comments: CommentItem[];
  replies: ReplyItem[];
  violations: ViolationItem[];
}

interface MemberDetailDialogProps {
  tinyid: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFeedClick?: (feedId: string) => void;
}

const roleLabels: Record<string, string> = {
  owner: '频道主',
  admin: '管理员',
  moderator: '版主',
  member: '成员',
};

const actionLabels: Record<string, string> = {
  move: '移帖',
  delete: '删帖',
  delete_comment: '删评论',
};

type Tab = 'feeds' | 'comments' | 'violations';

const tabs: { key: Tab; label: string }[] = [
  { key: 'feeds', label: '发帖' },
  { key: 'comments', label: '评论' },
  { key: 'violations', label: '违规' },
];

export function MemberDetailDialog({ tinyid, open, onOpenChange, onFeedClick }: MemberDetailDialogProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MemberHistoryData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('feeds');

  useEffect(() => {
    if (open && tinyid) {
      setLoading(true);
      setData(null);
      setActiveTab('feeds');
      api.get<MemberHistoryData>(`/members/${tinyid}/history`)
        .then(setData)
        .catch(() => toast.error('获取成员历史失败'))
        .finally(() => setLoading(false));
    }
  }, [open, tinyid]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{data?.member.nickname || '成员详情'}</DialogTitle>
          <DialogDescription>
            {data?.member.tinyid && (
              <span className="font-mono text-xs">{data.member.tinyid}</span>
            )}
            {data?.member.role && (
              <span className="ml-2">
                · {roleLabels[data.member.role] || data.member.role}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 -mx-4 px-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-lg bg-gray-200" />
              <Skeleton className="h-4 w-48 bg-gray-200" />
              <Skeleton className="h-20 rounded-lg bg-gray-200" />
              <Skeleton className="h-4 w-48 bg-gray-200" />
              <Skeleton className="h-20 rounded-lg bg-gray-200" />
            </div>
          ) : data ? (
            <div className="space-y-4">
              {/* Stats grid */}
              <div className="grid grid-cols-5 gap-2">
                {[
                  { label: '发帖', value: data.stats.feedCount },
                  { label: '评论', value: data.stats.commentCount + data.stats.replyCount },
                  { label: '获赞', value: data.stats.likeCount },
                  { label: '违规', value: data.stats.violationCount },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-lg bg-gray-50 p-2.5 text-center ring-1 ring-gray-100">
                    <div className="text-base font-bold text-gray-900">{stat.value}</div>
                    <div className="text-[11px] text-gray-500">{stat.label}</div>
                  </div>
                ))}
              </div>

              <Separator className="bg-gray-200" />

              {/* Tabs */}
              <div className="flex gap-1">
                {tabs.map((tab) => (
                  <Button
                    key={tab.key}
                    variant={activeTab === tab.key ? 'default' : 'ghost'}
                    size="sm"
                    className="text-xs"
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                    <span className="ml-1 text-[10px] opacity-60">
                      {tab.key === 'feeds' ? data.stats.feedCount :
                       tab.key === 'comments' ? data.stats.commentCount + data.stats.replyCount :
                       data.stats.violationCount}
                    </span>
                  </Button>
                ))}
              </div>

              {/* Tab content */}
              <div className="min-h-[200px]">
                {activeTab === 'feeds' && (
                  data.feeds.length > 0 ? (
                    <div className="space-y-2">
                      {data.feeds.map((feed) => (
                        <div
                          key={feed.id}
                          className="rounded-lg bg-gray-50 px-3 py-2.5 ring-1 ring-gray-100 cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => onFeedClick?.(feed.feedId)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-gray-900 truncate">{feed.title || '(无标题)'}</span>
                            <span className="text-[11px] text-gray-400 shrink-0">
                              {new Date(feed.createdAt).toLocaleDateString('zh-CN')}
                            </span>
                          </div>
                          {feed.content && (
                            <p className="mt-1 text-xs text-gray-500 line-clamp-2">{feed.content}</p>
                          )}
                          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-gray-400">
                            <span className="flex items-center gap-0.5">
                              <ThumbsUp className="size-3" /> {feed.likeCount}
                            </span>
                            <span className="flex items-center gap-0.5">
                              <MessageCircle className="size-3" /> {feed.commentCount}
                            </span>
                            {feed.status !== 'active' && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0">
                                {feed.status === 'deleted' ? '已删除' : '已移帖'}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-8 text-center text-sm text-gray-400">暂无发帖</p>
                  )
                )}

                {activeTab === 'comments' && (
                  (data.comments.length > 0 || data.replies.length > 0) ? (
                    <div className="space-y-2">
                      {[...data.comments.map(c => ({ ...c, kind: 'comment' as const, ts: c.createdAt })),
                        ...data.replies.map(r => ({ ...r, kind: 'reply' as const, ts: r.createdAt }))]
                        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
                        .map((item) => (
                        <div
                          key={item.kind + item.id}
                          className="rounded-lg bg-gray-50 px-3 py-2.5 ring-1 ring-gray-100 cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => item.feedId && onFeedClick?.(item.feedId)}
                        >
                          {item.kind === 'reply' && (
                            <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1">
                              <CornerDownRight className="size-3 shrink-0" />
                              {'targetUser' in item && item.targetUser && (
                                <span>回复 <span className="text-blue-500">@{item.targetUser}</span></span>
                              )}
                            </div>
                          )}
                          <p className="text-sm text-gray-700 line-clamp-2">{item.content}</p>
                          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-400">
                            <span className="truncate">帖子: {'feedTitle' in item ? item.feedTitle || '(未知)' : '(未知)'}</span>
                            <span className="shrink-0">{new Date(item.ts).toLocaleDateString('zh-CN')}</span>
                            {'likeCount' in item && item.likeCount > 0 && (
                              <span className="flex items-center gap-0.5 shrink-0">
                                <ThumbsUp className="size-3" /> {item.likeCount}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-8 text-center text-sm text-gray-400">暂无评论</p>
                  )
                )}

                {activeTab === 'violations' && (
                  data.violations.length > 0 ? (
                    <div className="space-y-2">
                      {data.violations.map((v) => (
                        <div key={v.id} className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2.5 ring-1 ring-red-100">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="size-3.5 text-red-400 shrink-0" />
                            <span className="text-sm text-gray-700">{v.reason}</span>
                            <Badge variant="outline" className="text-[10px] px-1 py-0 text-red-500">
                              {actionLabels[v.actionType] || v.actionType}
                            </Badge>
                          </div>
                          <span className="text-[11px] text-gray-400 shrink-0">
                            {new Date(v.createdAt).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-8 text-center text-sm text-gray-400">暂无违规记录</p>
                  )
                )}
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">加载失败</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
