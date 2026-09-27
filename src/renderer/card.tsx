import React from 'react'
import type { TweetData, ThemeMode, TweetMedia } from '../types.js'

export interface CardThemeColors {
  bg: string
  text: string
  secondary: string
  border: string
  surface: string
  link: string
}

export const THEMES: Record<ThemeMode, CardThemeColors> = {
  dark: {
    bg: '#000000',
    text: '#e7e9ea',
    secondary: '#71767b',
    border: '#2f3336',
    surface: '#16181c',
    link: '#1d9bf0',
  },
  dim: {
    bg: '#15202b',
    text: '#f7f9f9',
    secondary: '#8b98a5',
    border: '#38444d',
    surface: '#1e2732',
    link: '#1d9bf0',
  },
  light: {
    bg: '#ffffff',
    text: '#0f1419',
    secondary: '#536471',
    border: '#cfd9de',
    surface: '#f7f9f9',
    link: '#1d9bf0',
  },
}

function formatMetric(num?: number): string {
  if (num === undefined || num === null) return '0'
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return num.toLocaleString()
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString)
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return isoString
  }
}

function formatDuration(ms?: number): string {
  if (!ms) return ''
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

// X (formerly Twitter) logo icon
const XLogo = ({ color }: { color: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill={color}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

// Verified badge icon
const VerifiedBadge = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#1d9bf0" style={{ marginLeft: 4 }}>
    <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.67-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.33 2.33 4.96-4.96 1.41 1.42-6.37 6.37z" />
  </svg>
)

// Video Play Button Overlay
const VideoOverlay = ({ durationMs }: { durationMs?: number }) => (
  <div
    style={{
      display: 'flex',
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      justifyContent: 'center',
      alignItems: 'center',
      pointerEvents: 'none',
    }}
  >
    <div
      style={{
        display: 'flex',
        width: 58,
        height: 58,
        borderRadius: 29,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        border: '2px solid rgba(255, 255, 255, 0.85)',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffff" style={{ marginLeft: 3 }}>
        <path d="M8 5v14l11-7z" />
      </svg>
    </div>
    {durationMs ? (
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          bottom: 10,
          right: 10,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          color: '#ffffff',
          fontSize: 12,
          fontWeight: 700,
          padding: '2px 7px',
          borderRadius: 4,
        }}
      >
        {formatDuration(durationMs)}
      </div>
    ) : null}
  </div>
)

export interface TweetCardProps {
  tweet: TweetData
  theme?: ThemeMode
}

export const TweetCard: React.FC<TweetCardProps> = ({ tweet, theme = 'dark' }) => {
  const colors = THEMES[theme] || THEMES.dark

  // Guard against extreme length for Satori / Telegram image dimension limit
  const MAX_CARD_TEXT_LEN = 1800
  const isTextTooLong = tweet.text && tweet.text.length > MAX_CARD_TEXT_LEN
  const cardText = isTextTooLong
    ? tweet.text.slice(0, MAX_CARD_TEXT_LEN) + '\n\n... (长文已折叠，全文请见下方消息)'
    : tweet.text

  const isTransTooLong = Boolean(tweet.translation && tweet.translation.length > MAX_CARD_TEXT_LEN)
  const cardTranslation = tweet.translation
    ? (isTransTooLong
        ? tweet.translation.slice(0, MAX_CARD_TEXT_LEN) + '\n\n... (长文已折叠，全文请见下方消息)'
        : tweet.translation)
    : null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 600,
        backgroundColor: colors.bg,
        color: colors.text,
        padding: '32px 32px 28px 32px',
        boxSizing: 'border-box',
        fontFamily: 'Noto Sans SC, sans-serif',
      }}
    >
      {/* Header: Author + Avatar + X Logo */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
          {tweet.author.avatarUrl ? (
            <img
              src={tweet.author.avatarUrl}
              alt={tweet.author.name}
              width={50}
              height={50}
              style={{
                borderRadius: '50%',
                marginRight: 14,
                objectFit: 'cover',
              }}
            />
          ) : (
            <div
              style={{
                width: 50,
                height: 50,
                borderRadius: '50%',
                backgroundColor: colors.surface,
                marginRight: 14,
              }}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: colors.text,
                  marginRight: 4,
                }}
              >
                {tweet.author.name}
              </span>
              {tweet.author.verified && <VerifiedBadge />}
            </div>
            <span
              style={{
                fontSize: 15,
                color: colors.secondary,
                marginTop: 2,
              }}
            >
              @{tweet.author.screenName}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', opacity: 0.8 }}>
          <XLogo color={colors.text} />
        </div>
      </div>

      {/* Tweet Body Text */}
      {cardText ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: cardText.length < 80 ? 21 : 18,
            lineHeight: 1.55,
            color: colors.text,
            marginBottom: cardTranslation ? 12 : 18,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {cardText}
        </div>
      ) : null}

      {/* Tweet Translation (if any) */}
      {cardTranslation ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: colors.surface,
            borderRadius: 14,
            borderLeft: `4px solid ${colors.link}`,
            padding: '12px 16px',
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              fontSize: 13,
              fontWeight: 700,
              color: colors.secondary,
              marginBottom: 6,
            }}
          >
            <span style={{ marginRight: 6 }}>🌐</span>
            <span>中文翻译</span>
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: cardTranslation.length < 80 ? 19 : 16,
              lineHeight: 1.55,
              color: colors.text,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {cardTranslation}
          </div>
        </div>
      ) : null}

      {/* Media: Images / Video Poster */}
      {tweet.media && tweet.media.length > 0 && (
        <div
          style={{
            display: 'flex',
            position: 'relative',
            flexDirection: 'column',
            marginBottom: 18,
            borderRadius: 16,
            overflow: 'hidden',
            border: `1px solid ${colors.border}`,
          }}
        >
          {tweet.media.length === 1 ? (
            <div style={{ display: 'flex', position: 'relative', width: '100%' }}>
              <img
                src={tweet.media[0].url}
                alt="Media"
                style={{
                  width: '100%',
                  maxHeight: 380,
                  objectFit: 'cover',
                }}
              />
              {tweet.media[0].type === 'video' && (
                <VideoOverlay durationMs={tweet.media[0].durationMs} />
              )}
            </div>
          ) : tweet.media.length === 2 ? (
            <div style={{ display: 'flex', flexDirection: 'row', gap: 4, height: 260 }}>
              <div style={{ display: 'flex', position: 'relative', width: '50%', height: '100%' }}>
                <img
                  src={tweet.media[0].url}
                  alt="Media 1"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                {tweet.media[0].type === 'video' && (
                  <VideoOverlay durationMs={tweet.media[0].durationMs} />
                )}
              </div>
              <div style={{ display: 'flex', position: 'relative', width: '50%', height: '100%' }}>
                <img
                  src={tweet.media[1].url}
                  alt="Media 2"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                {tweet.media[1].type === 'video' && (
                  <VideoOverlay durationMs={tweet.media[1].durationMs} />
                )}
              </div>
            </div>
          ) : (
            // 3 or 4 images: 2x2 grid
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, height: 320 }}>
              <div style={{ display: 'flex', flexDirection: 'row', gap: 4, height: '50%' }}>
                <img
                  src={tweet.media[0].url}
                  alt="Media 1"
                  style={{ width: '50%', height: '100%', objectFit: 'cover' }}
                />
                <img
                  src={tweet.media[1].url}
                  alt="Media 2"
                  style={{ width: '50%', height: '100%', objectFit: 'cover' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'row', gap: 4, height: '50%' }}>
                <img
                  src={tweet.media[2].url}
                  alt="Media 3"
                  style={{ width: tweet.media.length > 3 ? '50%' : '100%', height: '100%', objectFit: 'cover' }}
                />
                {tweet.media.length > 3 && (
                  <img
                    src={tweet.media[3].url}
                    alt="Media 4"
                    style={{ width: '50%', height: '100%', objectFit: 'cover' }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quoted Tweet (if any) */}
      {tweet.quotedTweet && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 16,
            marginBottom: 18,
            backgroundColor: colors.surface,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            {tweet.quotedTweet.author.avatarUrl && (
              <img
                src={tweet.quotedTweet.author.avatarUrl}
                alt={tweet.quotedTweet.author.name}
                width={22}
                height={22}
                style={{ borderRadius: '50%', marginRight: 8, objectFit: 'cover' }}
              />
            )}
            <span style={{ fontSize: 15, fontWeight: 700, color: colors.text, marginRight: 6 }}>
              {tweet.quotedTweet.author.name}
            </span>
            <span style={{ fontSize: 14, color: colors.secondary }}>
              @{tweet.quotedTweet.author.screenName}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 15,
              lineHeight: 1.45,
              color: colors.text,
              whiteSpace: 'pre-wrap',
              marginBottom: tweet.quotedTweet.translation ? 8 : 0,
            }}
          >
            {tweet.quotedTweet.text}
          </div>
          {tweet.quotedTweet.translation && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                borderTop: `1px dashed ${colors.border}`,
                paddingTop: 8,
                marginTop: 4,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontSize: 12,
                  fontWeight: 600,
                  color: colors.secondary,
                  marginBottom: 4,
                }}
              >
                <span style={{ marginRight: 4 }}>🌐</span>
                <span>中文翻译</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 14,
                  lineHeight: 1.45,
                  color: colors.text,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {tweet.quotedTweet.translation}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Timestamp */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          color: colors.secondary,
          fontSize: 14,
          marginBottom: 14,
        }}
      >
        <span>{formatDate(tweet.createdAt)}</span>
      </div>

      {/* Divider */}
      <div
        style={{
          display: 'flex',
          height: 1,
          backgroundColor: colors.border,
          marginBottom: 14,
        }}
      />

      {/* Metrics Row */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 28,
          fontSize: 14,
          color: colors.secondary,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
          <span style={{ marginRight: 6 }}>❤️</span>
          <span style={{ fontWeight: 700, color: colors.text, marginRight: 4 }}>
            {formatMetric(tweet.metrics.likes)}
          </span>
          <span>喜欢</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
          <span style={{ marginRight: 6 }}>🔁</span>
          <span style={{ fontWeight: 700, color: colors.text, marginRight: 4 }}>
            {formatMetric(tweet.metrics.retweets)}
          </span>
          <span>转推</span>
        </div>

        {tweet.metrics.views !== undefined && (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
            <span style={{ marginRight: 6 }}>👁️</span>
            <span style={{ fontWeight: 700, color: colors.text, marginRight: 4 }}>
              {formatMetric(tweet.metrics.views)}
            </span>
            <span>浏览</span>
          </div>
        )}
      </div>
    </div>
  )
}
