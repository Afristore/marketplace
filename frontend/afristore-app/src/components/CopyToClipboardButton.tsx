'use client'

import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useTranslation } from '@/lib/i18n/useTranslation'

interface CopyToClipboardButtonProps {
  text: string
  className?: string
  ariaLabel?: string
}

export function CopyToClipboardButton({
  text,
  className = '',
  ariaLabel,
}: CopyToClipboardButtonProps) {
  const { copied, copy } = useCopyToClipboard()
  const { t } = useTranslation()

  const handleCopy = async () => {
    await copy(text)
  }

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors ${className}`}
      aria-label={
        ariaLabel || `${t('wallet.copyAddress')}: ${text.substring(0, 10)}...`
      }
      title={copied ? t('wallet.copied') : t('wallet.copyAddress')}
    >
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
        />
      </svg>
      <span className="text-sm font-medium">
        {copied ? t('wallet.copied') : t('wallet.copyAddress')}
      </span>
    </button>
  )
}
