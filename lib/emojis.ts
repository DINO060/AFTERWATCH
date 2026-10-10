// The emoji picker's choice, by category. The phone's own keyboard has every emoji; this short list
// covers what people use to react to an episode, without loading a library. Only emojis that
// older systems (Windows 10, older phones) can draw.
// prettier-ignore
export const EMOJI_GROUPS = {
  smileys: [
    '😀', '😁', '😂', '🤣', '😅', '😊', '😍', '🥰', '😘', '😎', '🤩', '😇',
    '😭', '😢', '😏', '😱', '😨', '😰', '😳', '🤯', '😤', '😡', '🤬', '😪',
    '😴', '🤔', '🙃', '😶', '🙄', '😬', '🤐', '🤫', '🥶', '🥵', '🤡', '💀',
    '👀', '🤗', '🤓', '😈', '👻', '🤖',
  ],
  gestures: [
    '👍', '👎', '👏', '🙌', '🙏', '🤝', '👊', '✊', '✌️', '🤞', '🤟', '💪',
    '👋', '🤙', '👌', '🖐️', '☝️', '👉', '👇', '✍️', '🧠', '🦾',
  ],
  hearts: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💘', '💖', '💕', '💞', '💯'],
  nature: ['🐱', '🐶', '🦊', '🐼', '🐉', '🦋', '🌸', '🌧️', '🌙', '⭐', '🌟', '✨', '⚡', '🔥', '❄️', '🌊'],
  food: ['🍿', '🍜', '🍣', '🍙', '🍕', '🍔', '🍩', '🍫', '☕', '🍵', '🥤', '🍻'],
  activity: ['⚔️', '🗡️', '🏹', '🛡️', '🎮', '🎬', '📺', '🎧', '🎤', '🏆', '🥇', '🎉', '🎊', '🎭', '🎨', '📚'],
  objects: ['📱', '💻', '📸', '🎥', '💡', '🔮', '💎', '👑', '🗝️', '⏳', '📌', '🧩'],
  symbols: ['✅', '❌', '⚠️', '❓', '❗', '‼️', '🔁', '🆕', '🔞', '💤', '💢', '💬'],
} as const;
export type EmojiGroup = keyof typeof EMOJI_GROUPS;
export const EMOJI_ICONS: Record<EmojiGroup, string> = {
  smileys: '😀',
  gestures: '👋',
  hearts: '❤️',
  nature: '🐱',
  food: '🍿',
  activity: '⚔️',
  objects: '💡',
  symbols: '✅',
};
