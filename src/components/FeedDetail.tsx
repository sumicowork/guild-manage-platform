'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ThumbsUp, MessageCircle, Clock } from 'lucide-react';

interface Comment {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  likeCount: number;
  replies?: Comment[];
}

interface Feed {
  id: string;
  author: string;
  channelName: string;
  title: string;
  content: string;
  images?: string[];
  createdAt: string;
  likeCount: number;
  commentCount: number;
  status: string;
  comments?: Comment[];
}

interface FeedDetailProps {
  feed: Feed | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleString('zh-CN');
}

function CommentItem({ comment, depth = 0 }: { comment: Comment; depth?: number }) {
  return (
    <div className={`${depth > 0 ? 'ml-6 border-l border-gray-200 pl-4' : ''}`}>
      <div className="py-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-gray-900">{comment.author}</span>
          <span className="text-gray-400">{formatTime(comment.createdAt)}</span>
          <span className="flex items-center gap-0.5 text-gray-400">
            <ThumbsUp className="size-3" />
            {comment.likeCount}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-gray-700 whitespace-pre-wrap">{comment.content}</p>
      </div>
      {comment.replies?.map((reply) => (
        <CommentItem key={reply.id} comment={reply} depth={depth + 1} />
      ))}
    </div>
  );
}

export function FeedDetail({ feed, open, onOpenChange }: FeedDetailProps) {
  if (!feed) return null;

  const statusColors: Record<string, string> = {
    active: 'bg-green-50 text-green-600',
    deleted: 'bg-red-50 text-red-600',
    moved: 'bg-amber-50 text-amber-600',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">{feed.title}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-4 px-4">
          <div className="space-y-4">
            {/* Meta */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="font-medium text-gray-900">{feed.author}</span>
              <span>·</span>
              <span>{feed.channelName}</span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {formatTime(feed.createdAt)}
              </span>
              <Badge className={statusColors[feed.status] || 'bg-gray-200 text-gray-700'}>
                {feed.status}
              </Badge>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <ThumbsUp className="size-3.5" />
                {feed.likeCount}
              </span>
              <span className="flex items-center gap-1">
                <MessageCircle className="size-3.5" />
                {feed.commentCount}
              </span>
            </div>

            {/* Content */}
            <div className="rounded-lg bg-gray-100 p-4">
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{feed.content}</p>
            </div>

            {/* Images */}
            {feed.images && feed.images.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {feed.images.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt={`图片 ${i + 1}`}
                    className="aspect-square rounded-lg object-cover ring-1 ring-gray-200"
                  />
                ))}
              </div>
            )}

            <Separator className="bg-gray-200" />

            {/* Comments */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-700">
                评论 ({feed.commentCount})
              </h3>
              {feed.comments && feed.comments.length > 0 ? (
                <div className="space-y-0 divide-y divide-gray-200">
                  {feed.comments.map((comment) => (
                    <CommentItem key={comment.id} comment={comment} />
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-gray-400">暂无评论</p>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
