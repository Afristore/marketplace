import { useState, useCallback } from 'react'

interface UseCopyToClipboardOptions {
  timeout?: number
}

export function useCopyToClipboard(options: UseCopyToClipboardOptions = {}) {
  const { timeout = 2000 } = options
  const [copied, setCopied] = useState(false)

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), timeout)
        return true
      } catch (error) {
        console.error('Failed to copy to clipboard:', error)
        return false
      }
    },
    [timeout]
  )

  return { copied, copy }
}
