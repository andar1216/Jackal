import { useEffect, useRef } from 'react'
import { usePlaidLink } from 'react-plaid-link'

type Props = {
  token: string
  onSuccess: (publicToken: string, institutionName?: string) => void
  /** Called when the person closes Plaid Link without finishing, or Link fails. */
  onExit: (errorMessage?: string) => void
}

/** Renders nothing. Mounting it with a link token opens Plaid Link straight away. */
export default function PlaidLauncher({ token, onSuccess, onExit }: Props) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken, metadata) => {
      if (!publicToken) return onExit('Plaid did not return a token. Please try again.')
      onSuccess(publicToken, metadata.institution?.name ?? undefined)
    },
    onExit: (err) => onExit(err?.display_message || err?.error_message || undefined),
  })

  // Open once. React's development double-run of effects must not open it twice.
  const opened = useRef(false)
  useEffect(() => {
    if (ready && !opened.current) {
      opened.current = true
      open()
    }
  }, [ready, open])

  return null
}
