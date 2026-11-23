import { useEffect, useRef } from 'react'

export function useFocusTrap(isOpen: boolean) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Escape key
      if (e.key === 'Escape') {
        e.preventDefault()
        const closeEvent = new CustomEvent('close-modal')
        ref.current?.dispatchEvent(closeEvent)
        document.dispatchEvent(closeEvent)
      }

      // Handle Tab key for focus trap
      if (e.key === 'Tab' && ref.current) {
        const focusableElements = ref.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        const firstElement = focusableElements[0] as HTMLElement
        const lastElement = focusableElements[
          focusableElements.length - 1
        ] as HTMLElement

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault()
            lastElement?.focus()
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault()
            firstElement?.focus()
          }
        }
      }
    }

    const handleEscapeKey = (e: CustomEvent) => {
      if (e.detail?.target === ref.current) return
      // Close modal on escape
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('close-modal', handleEscapeKey as EventListener)

    // Focus first focusable element
    const focusableElements = ref.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (focusableElements && focusableElements.length > 0) {
      ;(focusableElements[0] as HTMLElement).focus()
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('close-modal', handleEscapeKey as EventListener)
    }
  }, [isOpen])

  return ref
}
