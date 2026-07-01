'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { FeedDetail } from '@/components/FeedDetail';
import { ViolationDialog } from '@/components/ViolationDialog';
import { MemberDetailDialog } from '@/components/MemberDetailDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Search,
  ThumbsUp,
  MessageCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface Feed {
  id: string;
  feedId: string;
  author: string;
  authorId: string;
  channelName: string;
  title: string;
  content: string;
  contentSnippet: string;
  images?: string[];
  createdAt: string;
  likeCount: number;
  commentCount: number;
  status: string;
  comments?: Array<{
    id: string;
    commentId: string;
    author: string;
    authorId: string;
    feedId: string;
    content: string;
    createdAt: string;
    likeCount: number;
    status: string;
    replies?: Array<{
      id: string;
      replyId: string;
      author: string;
      authorId: string;
      content: string;
      createdAt: string;
      likeCount: number;
      status: string;
      targetReplyId?: string | null;
      targetUser?: string | null;
    }>;
  }>;
  matchedComments?: MatchedComment[];
}

interface MatchedComment {
  commentId: string;
  author: string;
  contentText: string;
  createTime: string;
}

interface Channel {
  id: string;
  name: string;
}

interface FeedListResponse {
  data: Feed[];
  total: number;
  page: number;
  pageSize: number;
}

interface ViolationTarget {
  type: 'feed' | 'comment' | 'reply';
  id: string;
  author: string;
  authorId: string;
  feedId?: string;
}

const statusColors: Record<string, string> = {
  active: 'bg-green-50 text-green-600',
  deleted: 'bg-red-50 text-red-600',
  moved: 'bg-amber-50 text-amber-600',
};

const statusLabels: Record<string, string> = {
  active: '正常',
  deleted: '已删除',
  moved: '已移帖',
};

/**
 * Highlight search terms in text by wrapping matches in <mark> tags.
 */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  // Split by case-insensitive match, preserving original text
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5">{part}</mark>
      : part
  );
}

export default function FeedsPage() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortField, setSortField] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);

  const [selectedFeed, setSelectedFeed] = useState<Feed | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const [violationOpen, setViolationOpen] = useState(false);
  const [violationTarget, setViolationTarget] = useState<ViolationTarget | null>(null);

  const [memberTinyid, setMemberTinyid] = useState<string | null>(null);
  const [memberOpen, setMemberOpen] = useState(false);

  const pageSize = 20;

  const fetchFeeds = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort: sortField,
        direction: sortDir,
      });
      if (search) params.set('search', search);
      if (channelFilter) params.set('channelId', channelFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const result = await api.get<FeedListResponse>(`/feeds?${params}`);
      setFeeds(result.data);
      setTotal(result.total);
    } catch {
      toast.error('获取帖子列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, search, channelFilter, statusFilter, sortField, sortDir, dateFrom, dateTo]);

  useEffect(() => {
    fetchFeeds();
  }, [fetchFeeds]);

  useEffect(() => {
    api.get<Channel[]>('/channels').then(setChannels).catch(() => {});
  }, []);

  // Load full feed detail (with comments + replies) on card click
  const handleCardClick = async (feed: Feed) => {
    setDetailLoading(true);
    try {
      const detail = await api.get<Feed>(`/feeds/${feed.feedId}`);
      setSelectedFeed(detail);
      setDetailOpen(true);
    } catch {
      toast.error('获取帖子详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleViolationFeed = (feedId: string, author: string, authorId: string) => {
    setViolationTarget({ type: 'feed', id: feedId, author, authorId });
    setViolationOpen(true);
  };

  const handleViolationComment = (commentId: string, author: string, authorId: string, feedId: string) => {
    setViolationTarget({ type: 'comment', id: commentId, author, authorId, feedId });
    setViolationOpen(true);
  };

  const handleViolationReply = (replyId: string, author: string, authorId: string, feedId: string) => {
    setViolationTarget({ type: 'reply', id: replyId, author, authorId, feedId });
    setViolationOpen(true);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">内容管理</h2>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="搜索标题/作者/帖子内容/评论内容..."
            className="w-60 pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select value={channelFilter} onValueChange={(v) => { setChannelFilter(v ?? ''); setPage(1); }}>
          <SelectTrigger>
            <span className="text-sm truncate">{channelFilter ? (channels.find(c => c.id === channelFilter)?.name || '全部版块') : '全部版块'}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部版块</SelectItem>
            {channels.map((ch) => (
              <SelectItem key={ch.id} value={ch.id}>
                {ch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v ?? ''); setPage(1); }}>
          <SelectTrigger>
            <span className="text-sm">{{ '': '全部状态', active: '正常', deleted: '已删除' }[statusFilter] || '全部状态'}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部状态</SelectItem>
            <SelectItem value="active">正常</SelectItem>
            <SelectItem value="deleted">已删除</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortField} onValueChange={(v) => { setSortField(v ?? 'createdAt'); setPage(1); }}>
          <SelectTrigger className="w-[120px]">
            <span className="text-sm">{{ createdAt: '按时间', likeCount: '按点赞', commentCount: '按评论' }[sortField] || '排序'}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="createdAt">按时间</SelectItem>
            <SelectItem value="likeCount">按点赞</SelectItem>
            <SelectItem value="commentCount">按评论</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); setPage(1); }}
          className="text-xs"
        >
          {sortDir === 'desc' ? '↓ 降序' : '↑ 升序'}
        </Button>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-blue-300"
          title="开始日期"
        />
        <span className="text-xs text-gray-400">至</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-blue-300"
          title="结束日期"
        />
      </div>

      {/* Card-based Feed List */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 animate-pulse">
              <div className="h-4 w-24 bg-gray-200 rounded mb-3" />
              <div className="h-4 w-full bg-gray-200 rounded mb-2" />
              <div className="h-4 w-3/4 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      ) : feeds.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-sm text-gray-400">
          暂无内容
        </div>
      ) : (
        <div className="space-y-3">
          {feeds.map((feed) => (
            <div
              key={feed.id}
              className="rounded-xl border border-gray-200 bg-white p-5 hover:border-blue-200 hover:shadow-sm transition-all cursor-pointer"
              onClick={() => handleCardClick(feed)}
            >
              {/* Header row */}
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                <span className="font-medium text-gray-900 hover:text-blue-600 cursor-pointer" onClick={(e) => { e.stopPropagation(); setMemberTinyid(feed.authorId); setMemberOpen(true); }}>{feed.author}</span>
                <span>·</span>
                <span>{feed.channelName}</span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {new Date(feed.createdAt).toLocaleString('zh-CN')}
                </span>
                <Badge className={statusColors[feed.status] || 'bg-gray-200 text-gray-700'}>
                  {statusLabels[feed.status] || feed.status}
                </Badge>
              </div>

              {/* Title */}
              <h3 className="text-sm font-medium text-gray-900 mb-1.5">
                {feed.title || '(无标题)'}
              </h3>

              {/* Content preview */}
              {(feed.contentSnippet || feed.content) && (
                <p className="text-sm text-gray-500 line-clamp-2 mb-3">
                  {feed.contentSnippet || feed.content}
                </p>
              )}

              {/* Images preview */}
              {feed.images && feed.images.length > 0 && (
                <div className="flex gap-1.5 mb-3">
                  {feed.images.slice(0, 3).map((img, i) => (
                    <img
                      key={i}
                      src={img}
                      alt={`图片 ${i + 1}`}
                      referrerPolicy="no-referrer"
                      className="size-16 rounded-lg object-cover ring-1 ring-gray-200"
                    />
                  ))}
                  {feed.images.length > 3 && (
                    <div className="size-16 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-400 ring-1 ring-gray-200">
                      +{feed.images.length - 3}
                    </div>
                  )}
                </div>
              )}

              {/* Matched comments from search */}
              {search && feed.matchedComments && feed.matchedComments.length > 0 && (
                <div className="mb-3 space-y-2">
                  <div className="text-xs text-gray-400 font-medium">
                    匹配评论 ({feed.matchedComments.length})
                  </div>
                  {feed.matchedComments.map((c) => (
                    <div
                      key={c.commentId}
                      className="text-xs bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="font-medium text-gray-700">{c.author}</span>
                        <span className="text-gray-400">
                          {new Date(c.createTime).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <p className="text-gray-600 leading-relaxed">
                        {highlightText(c.contentText, search)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <ThumbsUp className="size-3" />
                  {feed.likeCount}
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="size-3" />
                  {feed.commentCount}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-gray-400">
            共 {total} 条，第 {page}/{totalPages} 页
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Feed Detail Dialog */}
      <FeedDetail
        feed={selectedFeed}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onViolationFeed={handleViolationFeed}
        onViolationComment={handleViolationComment}
        onViolationReply={handleViolationReply}
      />

      {/* Violation Dialog */}
      {violationTarget && (
        <ViolationDialog
          open={violationOpen}
          onOpenChange={(open) => {
            setViolationOpen(open);
            if (!open) {
              setViolationTarget(null);
              fetchFeeds();
            }
          }}
          targetType={violationTarget.type}
          targetId={violationTarget.id}
          targetAuthor={violationTarget.author}
          targetAuthorId={violationTarget.authorId}
          targetFeedId={violationTarget.feedId}
        />
      )}

      {/* Member Detail Dialog */}
      <MemberDetailDialog
        tinyid={memberTinyid}
        open={memberOpen}
        onOpenChange={setMemberOpen}
      />
    </div>
  );
}
