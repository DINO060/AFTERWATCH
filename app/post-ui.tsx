'use client';
// A community post in the X / Threads style, and the pieces of writing one.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Flag,
  Heart,
  LoaderCircle,
  Lock,
  MessageCircle,
  MoreHorizontal,
  PencilLine,
  Share,
  Smile,
  Trash2,
  X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  PHOTOS_MAX,
  photoUrl,
  splitTags,
  topReactions,
  type Photo,
  type Reaction,
  type Spoiler,
} from '@/lib/community';
import { EMOJI_GROUPS, EMOJI_ICONS, type EmojiGroup } from '@/lib/emojis';
import { PhotoFailure, preparePhoto, type PreparedPhoto } from '@/lib/photos';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { Avatar, useAgo } from './community-ui';
import { useI18n } from './i18n-provider';

export const photoSrc = (path: string) => photoUrl(getSupabaseConfig()?.url ?? '', path);

/** Text with its #tags as buttons. */
export function RichText({
  text,
  onTag,
  className,
}: {
  text: string;
  onTag?: (tag: string) => void;
  className?: string;
}) {
  return (
    <p className={className ?? 'px-text'}>
      {splitTags(text).map((part, i) =>
        'tag' in part && onTag ? (
          <button key={i} type="button" className="px-tag" onClick={() => onTag(part.tag)}>
            {part.text}
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

/** 1 to 4 photos, laid out like X; a tap opens them full screen. */
export function PhotoGrid({ photos }: { photos: Photo[] }) {
  const { t } = useI18n();
  const h = t.community.hub;
  const [open, setOpen] = useState<number | null>(null);
  if (!photos.length) return null;
  const single = photos.length === 1 ? photos[0] : null;
  // One photo keeps its shape, between a wide 16:9 and a tall 4:5.
  const ratio = single ? Math.min(16 / 9, Math.max(4 / 5, single.w / single.h)) : undefined;
  return (
    <>
      <div
        className={`px-photos n${photos.length}`}
        style={ratio ? { aspectRatio: String(ratio) } : undefined}
      >
        {photos.map((p, i) => (
          <button
            key={`${i}:${p.path}`}
            type="button"
            onClick={() => setOpen(i)}
            aria-label={h.photo(i + 1, photos.length)}
          >
            <img src={photoSrc(p.path)} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="px-lightbox" showCloseButton={false}>
          <DialogTitle className="sr-only">
            {open !== null ? h.photo(open + 1, photos.length) : ''}
          </DialogTitle>
          <DialogDescription className="sr-only">{h.photo((open ?? 0) + 1, photos.length)}</DialogDescription>
          {open !== null && <img src={photoSrc(photos[open].path)} alt="" />}
          <button type="button" className="px-light-close" aria-label={h.close} onClick={() => setOpen(null)}>
            <X size={20} />
          </button>
          {photos.length > 1 && open !== null && (
            <>
              <button
                type="button"
                className="px-light-nav prev"
                aria-label={h.previous}
                onClick={() => setOpen((open + photos.length - 1) % photos.length)}
              >
                <ChevronLeft size={22} />
              </button>
              <button
                type="button"
                className="px-light-nav next"
                aria-label={h.next}
                onClick={() => setOpen((open + 1) % photos.length)}
              >
                <ChevronRight size={22} />
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A spoiler kept hidden: no text and no photo is shown, only what it is and a button. */
export function SpoilerCover({
  title,
  reason,
  photoCount,
  backdrop,
  busy,
  onShow,
}: {
  title: string;
  reason: string;
  photoCount: number;
  backdrop?: string;
  busy?: boolean;
  onShow: () => void;
}) {
  const { t } = useI18n();
  const h = t.community.hub;
  return (
    <div className={`px-spoiler${photoCount ? ' with-photos' : ''}`}>
      {photoCount > 0 && backdrop ? (
        <img className="px-spoiler-bg" src={backdrop} alt="" aria-hidden />
      ) : null}
      <div className="px-spoiler-lines" aria-hidden>
        <span />
        <span />
      </div>
      <div className="px-spoiler-body">
        <strong>
          {title === t.community.spoilerLater ? (
            <Lock size={15} aria-hidden />
          ) : (
            <EyeOff size={15} aria-hidden />
          )}
          {title}
        </strong>
        <span>
          {reason}
          {photoCount > 0 ? ` · ${h.hiddenPhotos(photoCount)}` : ''}
        </span>
        <button type="button" onClick={onShow} disabled={busy}>
          {busy ? <LoaderCircle size={14} className="loading-icon" /> : h.show}
        </button>
      </div>
    </div>
  );
}

export type PostData = {
  id: string;
  username: string | null;
  createdAt: string;
  edited: boolean;
  deleted: boolean;
  removed: boolean;
  kind: 'debrief' | 'reco';
  mine: boolean;
  rating: number | null;
  reactions: Partial<Record<Reaction, number>>;
  myReaction: Reaction | null;
};

/** One post as a row: avatar on the left, everything else on the right, a line under it. */
export function PostRow({
  post,
  reply,
  thread,
  context,
  children,
  replyCount,
  onReplies,
  onReply,
  onLike,
  onShare,
  onEdit,
  onDelete,
  onReport,
  menuExtra,
}: {
  post: PostData;
  /** A reply: smaller avatar, no score. */
  reply?: boolean;
  /** Draws the line that links this post to the replies under it. */
  thread?: boolean;
  /** Shown above the text: the work or episode it is about. */
  context?: ReactNode;
  /** The text, photos or spoiler cover, and anything embedded. */
  children: ReactNode;
  replyCount?: number;
  onReplies?: () => void;
  onReply?: () => void;
  onLike?: () => void;
  onShare?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onReport?: () => void;
  menuExtra?: ReactNode;
}) {
  const { t } = useI18n();
  const c = t.community;
  const ago = useAgo();
  const { total } = topReactions(post.reactions);
  const others = topReactions(post.reactions).emojis.filter((e) => e !== '❤️');
  const liked = !!post.myReaction;
  const hasMenu = !post.deleted && (post.mine ? onEdit || onDelete : onReport || menuExtra);
  return (
    <article className={`px-row${reply ? ' reply' : ''}${thread ? ' thread' : ''}`}>
      <div className="px-side">
        <Avatar name={post.username} round size={reply ? 'sm' : 'md'} />
        {thread && <span className="px-line" aria-hidden />}
      </div>
      <div className="px-main">
        <header className="px-head">
          <strong className="px-name">{post.username ?? c.deletedAccount}</strong>
          <span className="px-time">
            · {ago(post.createdAt)}
            {post.edited && !post.deleted ? ` · ${c.edited}` : ''}
          </span>
          {post.kind === 'reco' && <span className="dx-tag">{c.recoTag}</span>}
          {post.rating !== null && !reply && post.kind !== 'reco' && (
            <span
              className="px-score"
              title={c.authorVerdict(post.rating)}
              aria-label={c.authorVerdict(post.rating)}
            >
              {post.rating}
            </span>
          )}
          {hasMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="px-menu" aria-label={c.actions}>
                  <MoreHorizontal size={18} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {menuExtra}
                {post.mine ? (
                  <>
                    {onEdit && (
                      <DropdownMenuItem onClick={onEdit}>
                        <PencilLine />
                        {c.edit}
                      </DropdownMenuItem>
                    )}
                    {onDelete && (
                      <DropdownMenuItem className="danger" onClick={onDelete}>
                        <Trash2 />
                        {c.remove}
                      </DropdownMenuItem>
                    )}
                  </>
                ) : (
                  onReport && (
                    <DropdownMenuItem onClick={onReport}>
                      <Flag />
                      {c.report}
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="px-menu-spacer" />
          )}
        </header>
        {context}
        {post.deleted ? <p className="dx-gone">{post.removed ? c.removed : c.deleted}</p> : children}
        {!post.deleted && (
          <footer className="px-actions">
            {(onReplies || onReply) && (
              <button
                type="button"
                className="px-action"
                onClick={onReplies ?? onReply}
                aria-label={replyCount ? c.replies(replyCount) : c.reply}
              >
                <MessageCircle size={17} aria-hidden />
                {replyCount ? replyCount : ''}
              </button>
            )}
            {onLike && (
              <button
                type="button"
                className={`px-action like${liked ? ' on' : ''}`}
                aria-pressed={post.myReaction === 'heart'}
                aria-label={`${t.community.hub.like}, ${t.community.hub.reactionsAria(total)}`}
                onClick={onLike}
              >
                <Heart size={17} aria-hidden fill={liked ? 'currentColor' : 'none'} />
                {total > 0 ? total : ''}
                {others.length > 0 && <span className="px-others">{others.join('')}</span>}
              </button>
            )}
            {onReply && onReplies && (
              <button type="button" className="px-action text" onClick={onReply}>
                {c.reply}
              </button>
            )}
            {onShare && (
              <button
                type="button"
                className="px-action share"
                aria-label={t.community.hub.share}
                onClick={onShare}
              >
                <Share size={17} aria-hidden />
              </button>
            )}
          </footer>
        )}
      </div>
    </article>
  );
}

const RECENT_KEY = 'aw_recent_emojis';
function readRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((e) => typeof e === 'string').slice(0, 16) : [];
  } catch {
    return [];
  }
}

/** The 😀 button and its choice of emojis; the latest used come first. */
export function EmojiButton({ onPick, size = 19 }: { onPick: (emoji: string) => void; size?: number }) {
  const { t } = useI18n();
  const e = t.community.emojis;
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [group, setGroup] = useState<EmojiGroup | 'recent'>('smileys');
  const pick = (emoji: string) => {
    onPick(emoji);
    const next = [emoji, ...recent.filter((x) => x !== emoji)].slice(0, 16);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Private window: the recent list simply is not kept.
    }
  };
  const list = group === 'recent' ? recent : EMOJI_GROUPS[group];
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          const saved = readRecent();
          setRecent(saved);
          setGroup(saved.length ? 'recent' : 'smileys');
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="px-tool" aria-label={e.title}>
          <Smile size={size} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="px-emoji" align="start" side="top" sideOffset={8}>
        <div className="px-emoji-tabs" role="tablist" aria-label={e.title}>
          {recent.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={group === 'recent'}
              aria-label={e.recent}
              className={group === 'recent' ? 'on' : ''}
              onClick={() => setGroup('recent')}
            >
              🕘
            </button>
          )}
          {(Object.keys(EMOJI_GROUPS) as EmojiGroup[]).map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={group === g}
              aria-label={e[g]}
              className={group === g ? 'on' : ''}
              onClick={() => setGroup(g)}
            >
              {EMOJI_ICONS[g]}
            </button>
          ))}
        </div>
        <p className="px-emoji-title">{group === 'recent' ? e.recent : e[group]}</p>
        <div className="px-emoji-grid">
          {list.map((emoji) => (
            <button key={emoji} type="button" onClick={() => pick(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Inserts text where the cursor is, and puts the cursor after it. */
export function insertAtCursor(
  field: HTMLTextAreaElement | null,
  value: string,
  insert: string,
  setValue: (next: string) => void,
) {
  const start = field?.selectionStart ?? value.length;
  const end = field?.selectionEnd ?? value.length;
  setValue(value.slice(0, start) + insert + value.slice(end));
  window.requestAnimationFrame(() => {
    if (!field) return;
    field.focus();
    field.setSelectionRange(start + insert.length, start + insert.length);
  });
}

/** Photos chosen for a post, prepared (resized, cleaned) right away. */
export function usePhotoDraft(onError: (message: string) => void) {
  const { t } = useI18n();
  const m = t.community.compose;
  const [items, setItems] = useState<PreparedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => () => itemsRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = PHOTOS_MAX - items.length;
    if (room <= 0) return onError(m.maxPhotos);
    if (files.length > room) onError(m.maxPhotos);
    setBusy(true);
    const ready: PreparedPhoto[] = [];
    for (const file of [...files].slice(0, room)) {
      try {
        ready.push(await preparePhoto(file));
      } catch (e) {
        onError(m.photoErrors[e instanceof PhotoFailure ? e.key : 'unreadable']);
      }
    }
    setItems((current) => [...current, ...ready].slice(0, PHOTOS_MAX));
    setBusy(false);
  };
  const remove = (index: number) =>
    setItems((current) => {
      URL.revokeObjectURL(current[index].preview);
      return current.filter((_, i) => i !== index);
    });
  const clear = () =>
    setItems((current) => {
      current.forEach((p) => URL.revokeObjectURL(p.preview));
      return [];
    });
  return { items, busy, add, remove, clear };
}

export function PhotoDraft({
  items,
  onRemove,
}: {
  items: PreparedPhoto[];
  onRemove: (index: number) => void;
}) {
  const { t } = useI18n();
  if (!items.length) return null;
  return (
    <div className={`px-draft n${items.length}`}>
      {items.map((p, i) => (
        <div key={p.preview} className="px-draft-item">
          <img src={p.preview} alt="" />
          <button type="button" aria-label={t.community.compose.removePhoto} onClick={() => onRemove(i)}>
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** How much text is left, as a small ring (like X); the number shows near the end. */
export function CharRing({ used, max }: { used: number; max: number }) {
  const { t } = useI18n();
  const left = max - used;
  const share = Math.min(1, used / max);
  const tone = left < 0 ? '#ff8a8a' : left <= 20 ? '#ffd08a' : 'var(--primary)';
  return (
    <span
      className="px-ring"
      role="img"
      aria-label={t.community.compose.remaining(left)}
      style={{ background: `conic-gradient(${tone} ${share * 360}deg, #2f3340 0deg)` }}
    >
      <span>{left <= 20 ? left : ''}</span>
    </span>
  );
}

/** "Sans spoiler ▾": what a post contains. */
export function LevelMenu({
  level,
  levels,
  what,
  onChange,
}: {
  level: Spoiler;
  levels: Spoiler[];
  what: string;
  onChange: (level: Spoiler) => void;
}) {
  const { t } = useI18n();
  const c = t.community;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`dx-level${level !== 'none' ? ' on' : ''}`}
          aria-label={`${c.spoilerLevel} : ${c.levelChip[level]}`}
        >
          {level === 'none' ? (
            <Eye size={14} />
          ) : level === 'episode' ? (
            <EyeOff size={14} />
          ) : (
            <Lock size={14} />
          )}
          <span>{c.levelChip[level]}</span>
          <ChevronDown size={13} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="dx-level-menu">
        <DropdownMenuRadioGroup value={level} onValueChange={(v) => onChange(v as Spoiler)}>
          {levels.map((l) => (
            <DropdownMenuRadioItem key={l} value={l}>
              <span className="dx-level-option">
                <strong>
                  {l === 'none' ? c.levelNone : l === 'episode' ? c.levelEpisode(what) : c.levelLater}
                </strong>
                <span>
                  {l === 'none' ? c.levelNoneHint : l === 'episode' ? c.levelEpisodeHint : c.levelLaterHint}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
